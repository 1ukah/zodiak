package session

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/rtp/codecs"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"
	"github.com/pion/webrtc/v4/pkg/media/samplebuilder"
	"golang.org/x/sys/windows"

	"sharescreen/internal/audio"
	"sharescreen/internal/capture"
	"sharescreen/internal/encode"
	lk "sharescreen/internal/lk"
	"sharescreen/internal/present"
	"sharescreen/internal/w32"
)

type ShareOptions struct {
	Source  capture.Source
	Width   int
	Height  int
	FPS     int
	Bitrate int
	Audio   bool
}

type Screen struct {
	SID  string
	Name string
}

type Hooks struct {
	OnStatus       func(string)
	OnTracks       func()
	OnError        func(string)
	OnLocal        func(bgra []byte, w, h int)
	OnRemote       func(bgra []byte, w, h int)
	OnRemoteAudio  func()
	OnSharing      func(bool)
	OnDisconnected func()
	// DisableAudioPlayback keeps subscribed audio available to OnRemoteAudio
	// without opening the system output device. It is intended for automated
	// end-to-end tests, where playing captured system audio would create a loud
	// feedback loop on the same machine.
	DisableAudioPlayback bool
}

type Session struct {
	mu         sync.Mutex
	lifecycle  sync.Mutex
	shareMu    sync.Mutex
	generation uint64
	room       *lksdk.Room
	hooks      Hooks
	sinks      map[string]*present.Sink
	decoders   map[string]*encode.Decoder
	watchAudio map[string]string // video SID -> owning participant's audio key
	mixer      *audio.Mixer
	player     *audio.Player
	sharing    bool
	preview    bool
	stopShare  chan struct{}
	shareDone  sync.WaitGroup
	videoTrack *lksdk.LocalTrack
	videoSID   string
	audioTrack *lksdk.LocalTrack
	audioSID   string
	capture    *audio.Capture
	fpsNote    string
}

func New(hooks Hooks) *Session {
	return &Session{
		hooks:      hooks,
		sinks:      map[string]*present.Sink{},
		decoders:   map[string]*encode.Decoder{},
		watchAudio: map[string]string{},
		mixer:      audio.NewMixer(),
		preview:    true,
	}
}

// SetLocalPreview controls only the sender's local preview. Capture, encoding,
// and publication continue normally when it is disabled.
func (s *Session) SetLocalPreview(on bool) {
	s.mu.Lock()
	s.preview = on
	s.mu.Unlock()
}

func (s *Session) localPreviewEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.preview
}

func (s *Session) Join(url, token string) error {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	s.leaveLocked()
	s.mu.Lock()
	s.generation++
	generation := s.generation
	s.mu.Unlock()
	cb := &lksdk.RoomCallback{
		OnDisconnected: func() {
			go s.disconnected(generation)
		},
		OnReconnecting: func() {
			if s.active(generation) {
				s.status("reconnecting")
			}
		},
		OnReconnected: func() {
			if s.active(generation) {
				s.status("connected")
			}
		},
		OnParticipantConnected: func(rp *lksdk.RemoteParticipant) {
			if s.active(generation) {
				s.fireTracks()
			}
		},
		OnParticipantDisconnected: func(rp *lksdk.RemoteParticipant) {
			if s.active(generation) {
				s.fireTracks()
			}
		},
		ParticipantCallback: lksdk.ParticipantCallback{
			OnTrackPublished: func(pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
				if s.active(generation) {
					s.fireTracks()
				}
			},
			OnTrackUnpublished: func(pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
				if s.active(generation) {
					s.unwatch(pub.SID(), generation)
					s.fireTracks()
				}
			},
			OnTrackSubscribed: func(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
				if s.active(generation) {
					s.handleSub(track, pub, rp, generation)
				}
			},
		},
	}
	room, err := lksdk.ConnectToRoomWithToken(url, token, cb, lksdk.WithAutoSubscribe(false))
	if err != nil {
		return err
	}
	s.mu.Lock()
	if s.generation != generation {
		s.mu.Unlock()
		room.Disconnect()
		return errors.New("join canceled")
	}
	s.room = room
	s.mu.Unlock()
	if !s.hooks.DisableAudioPlayback {
		player, err := audio.OpenPlayer(s.mixer)
		if err != nil {
			s.status(err.Error())
		} else {
			s.mu.Lock()
			if s.generation != generation || s.room != room {
				s.mu.Unlock()
				player.Close()
				room.Disconnect()
				return errors.New("join canceled")
			}
			s.player = player
			s.mu.Unlock()
		}
	}
	s.status("connected")
	s.fireTracks()
	return nil
}

func (s *Session) Leave() {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	s.leaveLocked()
}

func (s *Session) leaveLocked() {
	s.mu.Lock()
	s.generation++
	room := s.room
	s.room = nil
	decoders := s.decoders
	sinks := s.sinks
	s.sinks = map[string]*present.Sink{}
	s.decoders = map[string]*encode.Decoder{}
	s.watchAudio = map[string]string{}
	player := s.player
	s.player = nil
	s.mu.Unlock()
	for _, sink := range sinks {
		sink.Close()
	}
	s.StopShare()
	// Close decoders after releasing the session mutex. Decode serializes its
	// native transform calls, so this cannot release an MFT while a receive
	// goroutine is inside it.
	for _, d := range decoders {
		d.Close()
	}
	if room != nil {
		room.Disconnect()
	}
	if player != nil {
		player.Close()
	}
	s.status("offline")
}

func (s *Session) active(generation uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.generation == generation
}

// disconnected tears down an unexpected connection loss. The generation is
// advanced before resource cleanup so callbacks from an old room cannot clear
// a newer join that is already in progress.
func (s *Session) disconnected(generation uint64) {
	s.lifecycle.Lock()
	defer s.lifecycle.Unlock()
	s.mu.Lock()
	if s.generation != generation {
		s.mu.Unlock()
		return
	}
	s.generation++
	s.room = nil
	decoders := s.decoders
	sinks := s.sinks
	s.sinks = map[string]*present.Sink{}
	s.decoders = map[string]*encode.Decoder{}
	s.watchAudio = map[string]string{}
	player := s.player
	s.player = nil
	s.mu.Unlock()
	for _, sink := range sinks {
		sink.Close()
	}

	s.StopShare()
	for _, d := range decoders {
		d.Close()
	}
	if player != nil {
		player.Close()
	}
	s.status("offline")
	s.fireTracks()
	if s.hooks.OnDisconnected != nil {
		s.hooks.OnDisconnected()
	}
}

func (s *Session) Sharing() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sharing
}

func (s *Session) FPSNote() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fpsNote
}

func (s *Session) Screens() []Screen {
	s.mu.Lock()
	room := s.room
	s.mu.Unlock()
	if room == nil {
		return nil
	}
	var out []Screen
	for _, p := range room.GetRemoteParticipants() {
		for _, pub := range p.TrackPublications() {
			if pub.Source() != livekit.TrackSource_SCREEN_SHARE {
				continue
			}
			if pub.Kind() != lksdk.TrackKindVideo {
				continue
			}
			name := p.Name()
			if name == "" {
				name = string(p.Identity())
			}
			out = append(out, Screen{SID: string(pub.SID()), Name: name})
		}
	}
	return out
}

func (s *Session) Watch(sid string, hwnd windows.HWND) error {
	s.mu.Lock()
	room := s.room
	generation := s.generation
	s.mu.Unlock()
	if room == nil {
		return errors.New("Not connected")
	}
	var video *lksdk.RemoteTrackPublication
	var audioPubs []*lksdk.RemoteTrackPublication
	owner := ""
	for _, p := range room.GetRemoteParticipants() {
		for _, pub := range p.TrackPublications() {
			if string(pub.SID()) == sid {
				remote, ok := pub.(*lksdk.RemoteTrackPublication)
				if !ok || pub.Source() != livekit.TrackSource_SCREEN_SHARE || pub.Kind() != lksdk.TrackKindVideo {
					return errors.New("That screen is no longer available")
				}
				video = remote
				owner = audioKey(p)
			}
		}
		if video != nil {
			for _, pub := range p.TrackPublications() {
				if pub.Source() == livekit.TrackSource_SCREEN_SHARE_AUDIO {
					if remote, ok := pub.(*lksdk.RemoteTrackPublication); ok {
						audioPubs = append(audioPubs, remote)
					}
				}
			}
			break
		}
	}
	if video == nil {
		return errors.New("That screen is no longer available")
	}
	s.mu.Lock()
	if s.room != room || s.generation != generation {
		s.mu.Unlock()
		return errors.New("Not connected")
	}
	s.sinks[sid] = present.New(hwnd)
	if owner != "" {
		s.watchAudio[sid] = owner
	}
	s.mu.Unlock()
	if err := video.SetSubscribed(true); err != nil {
		s.unwatch(sid, generation)
		return err
	}
	for _, pub := range audioPubs {
		_ = pub.SetSubscribed(true)
	}
	return nil
}

func (s *Session) Unwatch(sid string) {
	s.mu.Lock()
	generation := s.generation
	s.mu.Unlock()
	s.unwatch(sid, generation)
}

func (s *Session) unwatch(sid string, generation uint64) {
	s.mu.Lock()
	if s.generation != generation {
		s.mu.Unlock()
		return
	}
	room := s.room
	sink := s.sinks[sid]
	delete(s.sinks, sid)
	d := s.decoders[sid]
	delete(s.decoders, sid)
	owner := s.watchAudio[sid]
	delete(s.watchAudio, sid)
	lastForOwner := true
	if owner != "" {
		for _, watchedOwner := range s.watchAudio {
			if watchedOwner == owner {
				lastForOwner = false
				break
			}
		}
	}
	s.mu.Unlock()
	if sink != nil {
		sink.Close()
	}
	if d != nil {
		d.Close()
	}
	if owner != "" && lastForOwner {
		s.mixer.Remove(owner)
	}
	if room == nil {
		return
	}
	for _, p := range room.GetRemoteParticipants() {
		ownsScreen := false
		for _, pub := range p.TrackPublications() {
			if string(pub.SID()) == sid {
				unsubscribe(pub)
				ownsScreen = true
			}
		}
		if ownsScreen && lastForOwner {
			for _, pub := range p.TrackPublications() {
				if pub.Source() == livekit.TrackSource_SCREEN_SHARE_AUDIO {
					unsubscribe(pub)
				}
			}
		}
	}
}

func (s *Session) SetMute(sid string, mute bool) {
	s.mu.Lock()
	owner := s.watchAudio[sid]
	s.mu.Unlock()
	if owner != "" {
		s.mixer.SetMute(owner, mute)
	}
}

func (s *Session) Paint(hwnd windows.HWND) bool {
	s.mu.Lock()
	var sink *present.Sink
	for _, sn := range s.sinks {
		if sn.Handle() == hwnd {
			sink = sn
			break
		}
	}
	s.mu.Unlock()
	if sink == nil {
		return false
	}
	sink.Paint()
	return true
}

func (s *Session) Share(opts ShareOptions) error {
	s.shareMu.Lock()
	defer s.shareMu.Unlock()
	s.mu.Lock()
	room := s.room
	generation := s.generation
	s.mu.Unlock()
	if room == nil {
		return errors.New("Not connected")
	}
	if opts.FPS <= 0 {
		opts.FPS = 30
	}
	if opts.Bitrate <= 0 {
		opts.Bitrate = 6_000_000
	}
	s.stopShareLocked()
	sourceW, sourceH, err := capture.Dimensions(opts.Source)
	if err != nil {
		return err
	}
	tw, th := sourceW, sourceH
	if opts.Width > 0 && opts.Height > 0 {
		tw, th = capture.Fit(sourceW, sourceH, opts.Width, opts.Height)
	}
	tw &^= 1
	th &^= 1
	if tw < 2 || th < 2 {
		return errors.New("Selected source is too small to share")
	}
	enc, err := encode.NewEncoder(tw, th, opts.FPS, opts.Bitrate)
	if err != nil {
		return err
	}
	track, err := lksdk.NewLocalTrack(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264, ClockRate: 90000})
	if err != nil {
		enc.Close()
		return err
	}
	pub, err := room.LocalParticipant.PublishTrack(track, &lksdk.TrackPublicationOptions{
		Name:        "screen",
		Source:      lk.TrackSourceScreenShare(),
		VideoWidth:  tw,
		VideoHeight: th,
	})
	if err != nil {
		enc.Close()
		return err
	}
	var audioTrack *lksdk.LocalTrack
	var audioSID string
	var cap *audio.Capture
	note := ""
	if opts.Audio {
		c, mode, aerr := audio.OpenLoopback()
		if aerr != nil {
			s.err("System audio did not start")
		} else {
			cap = c
			if mode == "exclude" {
				note = "Discord audio is left out"
			}
			at, aterr := lksdk.NewLocalTrack(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypePCMU, ClockRate: 8000, Channels: 1})
			if aterr != nil {
				c.Close()
				cap = nil
				s.err("System audio did not start")
			} else {
				apub, perr := room.LocalParticipant.PublishTrack(at, &lksdk.TrackPublicationOptions{
					Name:   "screen_audio",
					Source: lk.TrackSourceScreenAudio(),
				})
				if perr != nil {
					c.Close()
					cap = nil
					s.err("System audio did not start")
				} else {
					audioTrack = at
					audioSID = string(apub.SID())
				}
			}
		}
	}
	stop := make(chan struct{})
	videoSID := string(pub.SID())
	s.mu.Lock()
	if s.room != room || s.generation != generation {
		s.mu.Unlock()
		if cap != nil {
			cap.Close()
		}
		if audioSID != "" {
			_ = room.LocalParticipant.UnpublishTrack(audioSID)
		}
		_ = room.LocalParticipant.UnpublishTrack(videoSID)
		enc.Close()
		return errors.New("connection closed while starting screen share")
	}
	s.sharing = true
	s.stopShare = stop
	s.videoTrack = track
	s.videoSID = videoSID
	s.audioTrack = audioTrack
	s.audioSID = audioSID
	s.capture = cap
	s.fpsNote = note
	s.mu.Unlock()
	s.shareDone.Add(1)
	go s.shareLoop(opts, tw, th, enc, track, audioTrack, cap, room, videoSID, audioSID, stop)
	w32.SleepBlock(true)
	return nil
}

func (s *Session) StopShare() {
	s.shareMu.Lock()
	defer s.shareMu.Unlock()
	s.stopShareLocked()
}

func (s *Session) stopShareLocked() {
	s.mu.Lock()
	stop := s.stopShare
	s.stopShare = nil
	s.sharing = false
	s.mu.Unlock()
	if stop != nil {
		close(stop)
		s.shareDone.Wait()
	}
	w32.SleepBlock(false)
}

func (s *Session) shareLoop(opts ShareOptions, tw, th int, enc *encode.Encoder, track *lksdk.LocalTrack, audioTrack *lksdk.LocalTrack, cap *audio.Capture, room *lksdk.Room, videoSID, audioSID string, stop chan struct{}) {
	defer s.shareDone.Done()
	defer enc.Close()
	var audioDone chan struct{}
	defer func() {
		if cap != nil {
			cap.Close()
		}
		if audioDone != nil {
			<-audioDone
		}
		notifyStopped := false
		s.mu.Lock()
		if s.videoTrack == track {
			notifyStopped = s.sharing
			s.sharing = false
			s.videoTrack = nil
			s.videoSID = ""
			s.audioTrack = nil
			s.audioSID = ""
			s.capture = nil
		}
		if s.stopShare == stop {
			s.stopShare = nil
		}
		s.mu.Unlock()
		if room != nil && audioSID != "" {
			_ = room.LocalParticipant.UnpublishTrack(audioSID)
		}
		if room != nil && videoSID != "" {
			_ = room.LocalParticipant.UnpublishTrack(videoSID)
		}
		if notifyStopped {
			w32.SleepBlock(false)
			if s.hooks.OnSharing != nil {
				s.hooks.OnSharing(false)
			}
		}
	}()
	if cap != nil && audioTrack != nil {
		audioDone = make(chan struct{})
		go s.shareAudio(cap, audioTrack, stop, audioDone)
	}
	tick := time.NewTicker(time.Second / time.Duration(opts.FPS))
	defer tick.Stop()
	started := time.Now()
	frames := 0
	checkedFPS := false
	// Keep the local preview smooth at up to 60 Hz without making a 120 fps
	// share repaint the UI twice as often as the display can show it.
	previewEvery := (opts.FPS + 59) / 60
	if previewEvery < 1 {
		previewEvery = 1
	}
	frameNumber := 0
	for {
		select {
		case <-stop:
			return
		case <-tick.C:
			frame, err := capture.GrabScaled(opts.Source, tw, th)
			if err != nil {
				s.err(err.Error())
				return
			}
			if len(frame.BGRA) < tw*th*4 {
				s.err("Could not capture the scaled screen frame")
				return
			}
			frameNumber++
			if s.hooks.OnLocal != nil && (frameNumber == 1 || frameNumber%previewEvery == 0) && s.localPreviewEnabled() {
				s.hooks.OnLocal(frame.BGRA, frame.Width, frame.Height)
			}
			nal, err := enc.Encode(frame.BGRA)
			if err != nil {
				s.mu.Lock()
				if s.fpsNote == "" {
					s.fpsNote = "Encoder could not hold the selected fps"
				}
				s.mu.Unlock()
				continue
			}
			if len(nal) == 0 {
				continue
			}
			if err := track.WriteSample(media.Sample{Data: nal, Duration: time.Second / time.Duration(opts.FPS)}, nil); err != nil {
				s.err("Screen share connection ended")
				return
			}
			frames++
			if !checkedFPS && time.Since(started) >= 3*time.Second {
				checkedFPS = true
				got := float64(frames) / time.Since(started).Seconds()
				if got < float64(opts.FPS)*0.8 {
					note := fmt.Sprintf("Sending about %.0f of %d fps; lower the resolution or frame rate for smoother sharing", got, opts.FPS)
					s.mu.Lock()
					s.fpsNote = note
					s.mu.Unlock()
					s.err(note)
				}
			}
		}
	}
}

func (s *Session) shareAudio(cap *audio.Capture, track *lksdk.LocalTrack, stop <-chan struct{}, done chan<- struct{}) {
	defer close(done)
	var buf []int16
	const need = 1920 // 20 ms of 48 kHz stereo PCM
	for {
		select {
		case <-stop:
			return
		default:
		}
		pcm, err := cap.Read()
		if err != nil {
			return
		}
		buf = append(buf, pcm...)
		for len(buf) >= need {
			select {
			case <-stop:
				return
			default:
			}
			chunk := buf[:need]
			buf = buf[need:]
			mono := audio.Downsample48kStereoTo8kMono(chunk)
			payload := audio.EncodePCMU(mono)
			if err := track.WriteSample(media.Sample{Data: payload, Duration: 20 * time.Millisecond}, nil); err != nil {
				return
			}
		}
	}
}

func (s *Session) handleSub(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant, generation uint64) {
	if !s.active(generation) {
		return
	}
	sid := string(pub.SID())
	if pub.Source() == livekit.TrackSource_SCREEN_SHARE_AUDIO && track.Kind() == webrtc.RTPCodecTypeAudio {
		id := audioKey(rp)
		if !s.audioWatched(id, generation) {
			return
		}
		go s.readAudio(track, id, generation)
		return
	}
	if pub.Source() != livekit.TrackSource_SCREEN_SHARE || track.Kind() != webrtc.RTPCodecTypeVideo {
		return
	}
	info := pub.TrackInfo()
	width, height := 0, 0
	if info != nil {
		width, height = int(info.Width), int(info.Height)
	}
	dec, err := encode.NewDecoder(width, height)
	if err != nil {
		s.err(err.Error())
		return
	}
	s.mu.Lock()
	if s.generation != generation {
		s.mu.Unlock()
		dec.Close()
		return
	}
	_, watched := s.sinks[sid]
	_, alreadyDecoding := s.decoders[sid]
	if !watched || alreadyDecoding {
		s.mu.Unlock()
		dec.Close()
		return
	}
	s.decoders[sid] = dec
	s.mu.Unlock()
	go s.readVideo(track, sid, dec, generation, rp.WritePLI)
}

const maxVideoLate = 1000

func newH264SampleBuilder(clockRate uint32) *samplebuilder.SampleBuilder {
	return samplebuilder.New(
		maxVideoLate,
		&codecs.H264Packet{},
		clockRate,
		samplebuilder.WithMaxTimeDelay(500*time.Millisecond),
	)
}

func (s *Session) readVideo(track *webrtc.TrackRemote, sid string, dec *encode.Decoder, generation uint64, writePLI lksdk.PLIWriter) {
	defer func() {
		s.mu.Lock()
		activeDecoder := s.generation == generation && s.decoders[sid] == dec
		_, watching := s.sinks[sid]
		if activeDecoder {
			delete(s.decoders, sid)
		}
		s.mu.Unlock()
		dec.Close()
		if activeDecoder && watching {
			// ReadRTP ending unexpectedly closes the last rendered frame and
			// removes the subscription. A later publication callback will also
			// update the available-screen list if the room still reports it.
			s.unwatch(sid, generation)
			s.fireTracks()
		}
	}()
	var lastPLI time.Time
	requestKeyframe := func() {
		if writePLI == nil || time.Since(lastPLI) < time.Second {
			return
		}
		lastPLI = time.Now()
		writePLI(track.SSRC())
	}
	builder := newH264SampleBuilder(track.Codec().ClockRate)
	requestKeyframe()
	for {
		rtp, _, err := track.ReadRTP()
		if err != nil {
			return
		}
		if !s.active(generation) {
			return
		}
		builder.Push(rtp)
		for sample := builder.Pop(); sample != nil; sample = builder.Pop() {
			if sample.PrevDroppedPackets != 0 {
				requestKeyframe()
			}
			s.decodeVideoSample(sample.Data, sid, dec, generation, requestKeyframe)
		}
	}
}

func (s *Session) decodeVideoSample(payload []byte, sid string, dec *encode.Decoder, generation uint64, requestKeyframe func()) {
	if len(payload) == 0 {
		return
	}
	bgra, w, h, err := dec.Decode(payload)
	if err != nil {
		s.mu.Lock()
		active := s.generation == generation && s.decoders[sid] == dec
		s.mu.Unlock()
		if !active {
			return
		}
		requestKeyframe()
		return
	}
	if len(bgra) == 0 {
		return
	}
	s.mu.Lock()
	if s.generation != generation {
		s.mu.Unlock()
		return
	}
	sink := s.sinks[sid]
	s.mu.Unlock()
	if sink != nil {
		sink.Draw(bgra, w, h)
	}
	if s.hooks.OnRemote != nil {
		s.hooks.OnRemote(bgra, w, h)
	}
}

func (s *Session) readAudio(track *webrtc.TrackRemote, id string, generation uint64) {
	for {
		rtp, _, err := track.ReadRTP()
		if err != nil {
			if !s.audioWatched(id, generation) {
				s.mixer.Remove(id)
			}
			return
		}
		if !s.audioWatched(id, generation) {
			return
		}
		s.mixer.Push(id, audio.UlawTo48kStereo(rtp.Payload))
		if s.hooks.OnRemoteAudio != nil {
			s.hooks.OnRemoteAudio()
		}
	}
}

func (s *Session) audioWatched(id string, generation uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.generation != generation {
		return false
	}
	for _, watchedID := range s.watchAudio {
		if watchedID == id {
			return true
		}
	}
	return false
}

func (s *Session) subscribeAudioFor(videoSID string) {
	s.mu.Lock()
	room := s.room
	s.mu.Unlock()
	if room == nil {
		return
	}
	for _, p := range room.GetRemoteParticipants() {
		owns := false
		for _, pub := range p.TrackPublications() {
			if string(pub.SID()) == videoSID {
				owns = true
			}
		}
		if !owns {
			continue
		}
		for _, pub := range p.TrackPublications() {
			if pub.Source() == livekit.TrackSource_SCREEN_SHARE_AUDIO {
				subscribe(pub)
			}
		}
	}
}

func (s *Session) closePlayer() {
	s.mu.Lock()
	p := s.player
	s.player = nil
	s.mu.Unlock()
	if p != nil {
		p.Close()
	}
}

func (s *Session) status(v string) {
	if s.hooks.OnStatus != nil {
		s.hooks.OnStatus(v)
	}
}

func (s *Session) err(v string) {
	if s.hooks.OnError != nil {
		s.hooks.OnError(v)
	}
}

func (s *Session) fireTracks() {
	if s.hooks.OnTracks != nil {
		s.hooks.OnTracks()
	}
}

func subscribe(pub lksdk.TrackPublication) {
	if rp, ok := pub.(*lksdk.RemoteTrackPublication); ok {
		_ = rp.SetSubscribed(true)
	}
}

func unsubscribe(pub lksdk.TrackPublication) {
	if rp, ok := pub.(*lksdk.RemoteTrackPublication); ok {
		_ = rp.SetSubscribed(false)
	}
}

func ownerSID(p *lksdk.RemoteParticipant, videoSID string) bool {
	for _, pub := range p.TrackPublications() {
		if string(pub.SID()) == videoSID {
			return true
		}
	}
	return false
}

func audioKey(p *lksdk.RemoteParticipant) string {
	return string(p.Identity())
}
