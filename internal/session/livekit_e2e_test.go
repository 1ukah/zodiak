package session_test

import (
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/webrtc/v4"

	"sharescreen/internal/capture"
	"sharescreen/internal/config"
	lk "sharescreen/internal/lk"
	"sharescreen/internal/rooms"
	"sharescreen/internal/session"
	"sharescreen/internal/w32"
)

// TestLiveKitScreenShareE2E verifies the real room service, signaling, screen
// capture, H.264 publishing, subscription, and RTP delivery path. It creates a
// uniquely named room and removes it afterwards. Run it explicitly with
// WELFARE_LIVEKIT_E2E=1 on a machine configured for the target LiveKit server.
func TestLiveKitScreenShareE2E(t *testing.T) {
	if os.Getenv("WELFARE_LIVEKIT_E2E") != "1" {
		t.Skip("set WELFARE_LIVEKIT_E2E=1 to run the real LiveKit end-to-end test")
	}
	cfg := config.Load()
	server, err := lk.Connect(cfg)
	if err != nil {
		t.Fatalf("connect room service: %v", err)
	}
	roomName := fmt.Sprintf("codex_e2e_%d", time.Now().UnixNano())
	if _, err := rooms.Create(cfg, roomName, "Codex E2E"); err != nil {
		t.Fatalf("create room: %v", err)
	}
	t.Cleanup(func() {
		if err := rooms.Delete(cfg, roomName); err != nil {
			t.Errorf("delete test room: %v", err)
		}
	})
	listed, err := rooms.List(cfg)
	if err != nil {
		t.Fatalf("list rooms: %v", err)
	}
	foundRoom := false
	for _, room := range listed {
		if room.Name == roomName {
			foundRoom = true
			break
		}
	}
	if !foundRoom {
		t.Fatal("created room was missing from the room list")
	}

	receiverToken, _, err := lk.MemberToken(server, roomName, "Codex Receiver")
	if err != nil {
		t.Fatalf("create receiver token: %v", err)
	}
	senderToken, senderID, err := lk.MemberToken(server, roomName, "Codex Sender")
	if err != nil {
		t.Fatalf("create sender token: %v", err)
	}
	videoRTP := make(chan error, 1)
	receiver, err := lksdk.ConnectToRoomWithToken(server.SignalURL, receiverToken, &lksdk.RoomCallback{
		ParticipantCallback: lksdk.ParticipantCallback{
			OnTrackSubscribed: func(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
				if string(rp.Identity()) != senderID || pub.Source() != livekit.TrackSource_SCREEN_SHARE || track.Kind() != webrtc.RTPCodecTypeVideo {
					return
				}
				go func() {
					_, _, readErr := track.ReadRTP()
					select {
					case videoRTP <- readErr:
					default:
					}
				}()
			},
		},
	}, lksdk.WithAutoSubscribe(true))
	if err != nil {
		t.Fatalf("join receiver: %v", err)
	}
	t.Cleanup(receiver.Disconnect)

	remoteFrames := make(chan struct{}, 1)
	remoteAudio := make(chan struct{}, 1)
	shareErrors := make(chan string, 16)
	viewerToken, _, err := lk.MemberToken(server, roomName, "Codex Viewer")
	if err != nil {
		t.Fatalf("create viewer token: %v", err)
	}
	viewer := session.New(session.Hooks{
		// The sender captures this machine's output. Playing the subscribed
		// audio here would feed it straight back into capture and produce a
		// loud loop; packet receipt is verified silently instead.
		DisableAudioPlayback: true,
		OnError: func(message string) {
			select {
			case shareErrors <- message:
			default:
			}
		},
		OnRemote: func(_ []byte, _, _ int) {
			select {
			case remoteFrames <- struct{}{}:
			default:
			}
		},
		OnRemoteAudio: func() {
			select {
			case remoteAudio <- struct{}{}:
			default:
			}
		},
	})
	if err := viewer.Join(server.SignalURL, viewerToken); err != nil {
		t.Fatalf("join viewer: %v", err)
	}
	t.Cleanup(viewer.Leave)
	viewerWindow := w32.Create(0, w32.WS_OVERLAPPEDWINDOW, "STATIC", "", 0, 0, 1, 1, 0, 0)
	if viewerWindow == 0 {
		t.Fatal("create viewer surface")
	}
	t.Cleanup(func() { w32.Destroy(viewerWindow) })

	var source *capture.Source
	for _, candidate := range capture.List() {
		if candidate.Kind == capture.KindScreen {
			copy := candidate
			source = &copy
			break
		}
	}
	if source == nil {
		t.Fatal("no screen source available for the E2E test")
	}

	sender := session.New(session.Hooks{
		OnError: func(message string) {
			select {
			case shareErrors <- message:
			default:
			}
		},
	})
	if err := sender.Join(server.SignalURL, senderToken); err != nil {
		t.Fatalf("join sender: %v", err)
	}
	t.Cleanup(sender.Leave)
	if err := sender.Share(session.ShareOptions{
		Source:  *source,
		Width:   320,
		Height:  180,
		FPS:     15,
		Bitrate: 1_000_000,
		Audio:   true,
	}); err != nil {
		t.Fatalf("start screen share: %v", err)
	}
	t.Cleanup(sender.StopShare)

	var screenSID string
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(25 * time.Millisecond) {
		screens := viewer.Screens()
		if len(screens) > 0 {
			screenSID = screens[0].SID
			break
		}
	}
	if screenSID == "" {
		t.Fatal("viewer did not discover the shared screen")
	}
	if err := viewer.Watch(screenSID, viewerWindow); err != nil {
		t.Fatalf("watch shared screen: %v", err)
	}

	gotRTP, gotFrame, gotAudio := false, false, false
	timeout := time.NewTimer(15 * time.Second)
	defer timeout.Stop()
	for !(gotRTP && gotFrame && gotAudio) {
		select {
		case err := <-videoRTP:
			if err != nil {
				t.Fatalf("receive shared-screen RTP: %v", err)
			}
			gotRTP = true
		case <-remoteFrames:
			gotFrame = true
		case <-remoteAudio:
			gotAudio = true
		case message := <-shareErrors:
			t.Fatalf("screen share reported an error: %s", message)
		case <-timeout.C:
			t.Fatal("timed out waiting for shared-screen video and audio")
		}
	}
}
