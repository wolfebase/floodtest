package db

import (
	"testing"
)

func TestSpeedtestHistory_InsertAndQuery(t *testing.T) {
	d := testDB(t)

	// Insert a row.
	_, err := d.Exec(
		`INSERT INTO speedtest_history (timestamp, download_mbps, upload_mbps, streams)
		 VALUES ('2026-04-01T12:00:00Z', 940.5, 450.2, 16)`,
	)
	if err != nil {
		t.Fatalf("insert into speedtest_history: %v", err)
	}

	// Query it back.
	var id int
	var ts string
	var dlMbps, ulMbps float64
	var streams int
	err = d.QueryRow(
		`SELECT id, timestamp, download_mbps, upload_mbps, streams FROM speedtest_history WHERE id = 1`,
	).Scan(&id, &ts, &dlMbps, &ulMbps, &streams)
	if err != nil {
		t.Fatalf("query speedtest_history: %v", err)
	}

	if id != 1 {
		t.Errorf("expected id=1, got %d", id)
	}
	if ts != "2026-04-01T12:00:00Z" {
		t.Errorf("expected timestamp '2026-04-01T12:00:00Z', got %q", ts)
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
