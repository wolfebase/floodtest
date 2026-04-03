package speedtest

import (
	"testing"
	"time"

	"wansaturator/internal/db"
)

func TestSaveResult_RoundTrip(t *testing.T) {
	d, err := db.OpenDB(":memory:")
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	defer d.Close()

	ts := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	r := Result{
		DownloadMbps: 940.5,
		UploadMbps:   450.2,
		Timestamp:    ts,
		Streams:      16,
	}

	if err := SaveResult(d, r); err != nil {
		t.Fatalf("SaveResult: %v", err)
	}

	var id int
	var savedTS string
	var dlMbps, ulMbps float64
	var streams int
	err = d.QueryRow(
		`SELECT id, timestamp, download_mbps, upload_mbps, streams FROM speedtest_history WHERE id = 1`,
	).Scan(&id, &savedTS, &dlMbps, &ulMbps, &streams)
	if err != nil {
		t.Fatalf("query: %v", err)
	}

	if id != 1 {
		t.Errorf("expected id=1, got %d", id)
	}
	if savedTS != "2026-04-01T12:00:00Z" {
		t.Errorf("expected timestamp '2026-04-01T12:00:00Z', got %q", savedTS)
	}
	if dlMbps != 940.5 {
		t.Errorf("expected download_mbps=940.5, got %f", dlMbps)
	}
	if ulMbps != 450.2 {
		t.Errorf("expected upload_mbps=450.2, got %f", ulMbps)
	}
	if streams != 16 {
		t.Errorf("expected streams=16, got %d", streams)
	}
}
