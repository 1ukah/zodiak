package lk

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"sharescreen/internal/config"
)

type Server struct {
	Client    *lksdk.RoomServiceClient
	SignalURL string
	APIKey    string
	APISecret string
}

func Connect(cfg config.Config) (Server, error) {
	if cfg.APIKey == "" || cfg.APISecret == "" {
		return Server{}, errors.New("Add the API key and secret in Server settings")
	}
	resolved, err := config.ResolveServer(cfg.URL)
	if err != nil {
		return Server{}, err
	}
	return Server{
		Client:    lksdk.NewRoomServiceClient(resolved.APIURL, cfg.APIKey, cfg.APISecret),
		SignalURL: resolved.SignalURL,
		APIKey:    cfg.APIKey,
		APISecret: cfg.APISecret,
	}, nil
}

func Explain(err error, signalURL string) error {
	if err == nil {
		return nil
	}
	if IsMissingRoom(err) {
		return errors.New("That room no longer exists")
	}
	text := strings.ToLower(err.Error())
	if strings.Contains(text, "unauthorized") || strings.Contains(text, "permission denied") || strings.Contains(text, "invalid api key") {
		return errors.New("The API key or secret was rejected. Check the server settings.")
	}
	if strings.Contains(text, "econnrefused") || strings.Contains(text, "enotfound") || strings.Contains(text, "timeout") || strings.Contains(text, "expired") || strings.Contains(text, "network") {
		return errors.New("Could not reach the LiveKit server at " + signalURL + ".")
	}
	return err
}

func IsMissingRoom(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "not_found") || strings.Contains(text, "does not exist") || strings.Contains(text, "not found")
}

func WithTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 8*time.Second)
}

func MemberToken(server Server, room, displayName string) (token, identity string, err error) {
	identity = identityFor(displayName)
	canPublish := true
	canSubscribe := true
	canPublishData := false
	at := auth.NewAccessToken(server.APIKey, server.APISecret)
	at.SetIdentity(identity).
		SetName(displayName).
		SetValidFor(6 * time.Hour).
		SetMetadata(mustJSON(map[string]string{"role": "member"})).
		SetVideoGrant(&auth.VideoGrant{
			RoomJoin:          true,
			Room:              room,
			CanPublish:        &canPublish,
			CanSubscribe:      &canSubscribe,
			CanPublishData:    &canPublishData,
			CanPublishSources: []string{"screen_share", "screen_share_audio"},
		})
	jwt, err := at.ToJWT()
	if err != nil {
		return "", "", err
	}
	return jwt, identity, nil
}

func identityFor(name string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else if b.Len() > 0 && b.String()[b.Len()-1] != '-' {
			b.WriteByte('-')
		}
	}
	slug := strings.Trim(b.String(), "-")
	if len(slug) > 24 {
		slug = slug[:24]
	}
	if slug == "" {
		slug = "user"
	}
	var buf [3]byte
	_, _ = rand.Read(buf[:])
	return slug + "-" + hex.EncodeToString(buf[:])
}

func mustJSON(v map[string]string) string {
	data, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func TrackSourceScreenShare() livekit.TrackSource {
	return livekit.TrackSource_SCREEN_SHARE
}

func TrackSourceScreenAudio() livekit.TrackSource {
	return livekit.TrackSource_SCREEN_SHARE_AUDIO
}
