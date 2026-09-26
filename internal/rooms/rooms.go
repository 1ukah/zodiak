package rooms

import (
	"context"
	"encoding/json"
	"errors"
	"sort"

	"github.com/livekit/protocol/livekit"
	"sharescreen/internal/config"
	lk "sharescreen/internal/lk"
)

const roomTTLSeconds = 60 * 60 * 24 * 30

type Summary struct {
	Name         string
	Participants uint32
	Sharing      bool
}

func List(cfg config.Config) ([]Summary, error) {
	server, err := lk.Connect(cfg)
	if err != nil {
		return nil, err
	}
	ctx, cancel := lk.WithTimeout(context.Background())
	defer cancel()
	res, err := server.Client.ListRooms(ctx, &livekit.ListRoomsRequest{})
	if err != nil {
		return nil, lk.Explain(err, server.SignalURL)
	}
	out := make([]Summary, 0, len(res.Rooms))
	for _, room := range res.Rooms {
		if room.Name == "" {
			continue
		}
		out = append(out, Summary{
			Name:         room.Name,
			Participants: room.NumParticipants,
			Sharing:      room.NumPublishers > 0,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func Create(cfg config.Config, name, displayName string) (Summary, error) {
	room, err := config.RequireRoom(name)
	if err != nil {
		return Summary{}, err
	}
	display, err := config.RequireDisplayName(displayName)
	if err != nil {
		return Summary{}, err
	}
	server, err := lk.Connect(cfg)
	if err != nil {
		return Summary{}, err
	}
	ctx, cancel := lk.WithTimeout(context.Background())
	defer cancel()
	existing, err := server.Client.ListRooms(ctx, &livekit.ListRoomsRequest{Names: []string{room}})
	if err != nil {
		return Summary{}, lk.Explain(err, server.SignalURL)
	}
	if len(existing.Rooms) > 0 {
		return Summary{}, errors.New("A room with that name already exists")
	}
	meta, _ := json.Marshal(map[string]string{"createdBy": display})
	created, err := server.Client.CreateRoom(ctx, &livekit.CreateRoomRequest{
		Name:             room,
		EmptyTimeout:     roomTTLSeconds,
		DepartureTimeout: roomTTLSeconds,
		Metadata:         string(meta),
	})
	if err != nil {
		return Summary{}, lk.Explain(err, server.SignalURL)
	}
	return Summary{Name: created.Name, Participants: created.NumParticipants, Sharing: created.NumPublishers > 0}, nil
}

func Delete(cfg config.Config, name string) error {
	room, err := config.RequireRoom(name)
	if err != nil {
		return err
	}
	server, err := lk.Connect(cfg)
	if err != nil {
		return err
	}
	ctx, cancel := lk.WithTimeout(context.Background())
	defer cancel()
	_, err = server.Client.DeleteRoom(ctx, &livekit.DeleteRoomRequest{Room: room})
	if err != nil {
		if lk.IsMissingRoom(err) {
			return nil
		}
		return lk.Explain(err, server.SignalURL)
	}
	return nil
}
