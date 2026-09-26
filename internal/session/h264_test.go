package session

import (
	"bytes"
	"testing"

	"github.com/pion/rtp"
)

func TestH264SampleBuilderAssemblesAccessUnit(t *testing.T) {
	builder := newH264SampleBuilder(90_000)
	first := []byte{0x67, 0x64, 0x00, 0x1f}
	second := []byte{0x65, 0x88, 0x84, 0x21}
	builder.Push(&rtp.Packet{Header: rtp.Header{SequenceNumber: 10, Timestamp: 9000}, Payload: first})
	if sample := builder.Pop(); sample != nil {
		t.Fatal("returned an access unit before its RTP marker")
	}
	builder.Push(&rtp.Packet{Header: rtp.Header{SequenceNumber: 11, Timestamp: 9000, Marker: true}, Payload: second})
	// Pion waits for the beginning of the next access unit so it can calculate
	// duration and still accept reordered packets from the marked unit.
	builder.Push(&rtp.Packet{Header: rtp.Header{SequenceNumber: 12, Timestamp: 12000, Marker: true}, Payload: []byte{0x61, 0x01}})
	sample := builder.Pop()
	if sample == nil {
		t.Fatal("did not return the complete access unit")
	}
	want := append([]byte{0, 0, 0, 1}, first...)
	want = append(want, 0, 0, 0, 1)
	want = append(want, second...)
	if !bytes.Equal(sample.Data, want) {
		t.Fatalf("assembled access unit = %x, want %x", sample.Data, want)
	}
}

func TestH264SampleBuilderAssemblesFragmentedNALU(t *testing.T) {
	builder := newH264SampleBuilder(90_000)
	packets := []*rtp.Packet{
		{Header: rtp.Header{SequenceNumber: 20, Timestamp: 18000}, Payload: []byte{0x7c, 0x85, 1, 2}},
		{Header: rtp.Header{SequenceNumber: 21, Timestamp: 18000}, Payload: []byte{0x7c, 0x05, 3, 4}},
		{Header: rtp.Header{SequenceNumber: 22, Timestamp: 18000, Marker: true}, Payload: []byte{0x7c, 0x45, 5, 6}},
	}
	for _, packet := range packets {
		builder.Push(packet)
	}
	builder.Push(&rtp.Packet{Header: rtp.Header{SequenceNumber: 23, Timestamp: 21000, Marker: true}, Payload: []byte{0x61, 0x01}})
	sample := builder.Pop()
	if sample == nil {
		t.Fatal("did not return the fragmented NALU")
	}
	want := []byte{0, 0, 0, 1, 0x65, 1, 2, 3, 4, 5, 6}
	if !bytes.Equal(sample.Data, want) {
		t.Fatalf("assembled NALU = %x, want %x", sample.Data, want)
	}
}
