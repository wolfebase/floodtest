package stats

import (
	"database/sql"
	"testing"
	"time"

	"wansaturator/internal/db"
)

func testCollector(t *testing.T) (*Collector, *sql.DB) {
	t.Helper()
	d, err := db.OpenDB(":memory:")
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return NewCollector(d), d
}

func TestAddDownloadBytes_Atomic(t *testing.T) {
	c, _ := testCollector(t)

	c.AddDownloadBytes(1000)
	c.AddDownloadBytes(2000)

	got := c.downloadBytes.Swap(0)
	if got != 3000 {
		t.Fatalf("expected 3000 download bytes, got %d", got)
	}
}

func TestAddUploadBytes_Atomic(t *testing.T) {
	c, _ := testCollector(t)

	c.AddUploadBytes(500)
	c.AddUploadBytes(1500)

	got := c.uploadBytes.Swap(0)
	if got != 2000 {
		t.Fatalf("expected 2000 upload bytes, got %d", got)
	}
}

func TestCurrentRate_InitiallyZero(t *testing.T) {
	c, _ := testCollector(t)

	snap := c.CurrentRate()
	if snap.DownloadBps != 0 {
		t.Fatalf("expected 0 DownloadBps, got %d", snap.DownloadBps)
	}
	if snap.UploadBps != 0 {
		t.Fatalf("expected 0 UploadBps, got %d", snap.UploadBps)
	}
}

func TestRecentHistory_Empty(t *testing.T) {
	c, _ := testCollector(t)

	history := c.RecentHistory(10)
	if len(history) != 0 {
		t.Fatalf("expected empty history, got %d entries", len(history))
	}
}

func TestRecentHistory_ZeroSeconds(t *testing.T) {
	c, _ := testCollector(t)

	history := c.RecentHistory(0)
	if history != nil {
		t.Fatalf("expected nil for 0 seconds, got %v", history)
	}
}

func TestRateLoop_ComputesRate(t *testing.T) {
	c, _ := testCollector(t)

	// Simulate what rateLoop does: add bytes, swap, compute bits.
	c.AddDownloadBytes(1000)
	c.AddUploadBytes(500)

	dl := c.downloadBytes.Swap(0)
	ul := c.uploadBytes.Swap(0)

	snap := Snapshot{
		DownloadBps: dl * 8,
		UploadBps:   ul * 8,
		Timestamp:   time.Now(),
	}

	if snap.DownloadBps != 8000 {
		t.Fatalf("expected 8000 DownloadBps, got %d", snap.DownloadBps)
	}
	if snap.UploadBps != 4000 {
		t.Fatalf("expected 4000 UploadBps, got %d", snap.UploadBps)
	}

	// Store it just like rateLoop would.
	c.mu.Lock()
	c.currentRate = snap
	c.recentHistory = append(c.recentHistory, snap)
	c.mu.Unlock()

	got := c.CurrentRate()
	if got.DownloadBps != 8000 {
		t.Fatalf("CurrentRate DownloadBps: expected 8000, got %d", got.DownloadBps)
	}

	history := c.RecentHistory(1)
	if len(history) != 1 {
		t.Fatalf("expected 1 history entry, got %d", len(history))
	}
	if history[0].DownloadBps != 8000 {
		t.Fatalf("history DownloadBps: expected 8000, got %d", history[0].DownloadBps)
	}
}

func TestRecentHistory_TrimAt600(t *testing.T) {
	c, _ := testCollector(t)

	// Fill 610 entries directly, simulating what rateLoop does.
	c.mu.Lock()
	for i := 0; i < 610; i++ {
		c.recentHistory = append(c.recentHistory, Snapshot{
			DownloadBps: int64(i),
			UploadBps:   0,
			Timestamp:   time.Now(),
		})
	}
	// Apply the same trim logic as rateLoop.
	if len(c.recentHistory) > 600 {
		copy(c.recentHistory, c.recentHistory[len(c.recentHistory)-600:])
		c.recentHistory = c.recentHistory[:600]
	}
	c.mu.Unlock()

	history := c.RecentHistory(600)
	if len(history) != 600 {
		t.Fatalf("expected 600 entries after trim, got %d", len(history))
	}

	// The first entry should be index 10 from the original (610 - 600 = 10).
	if history[0].DownloadBps != 10 {
		t.Fatalf("expected first entry DownloadBps=10, got %d", history[0].DownloadBps)
	}

	// The last entry should be index 609 from the original.
	if history[599].DownloadBps != 609 {
		t.Fatalf("expected last entry DownloadBps=609, got %d", history[599].DownloadBps)
	}
}

func TestPersistMinute_WritesToDB(t *testing.T) {
	c, d := testCollector(t)

	// Populate 60 snapshots: each with 8000 download bps and 4000 upload bps.
	// 8000 bps / 8 = 1000 bytes/s per snapshot.
	// 4000 bps / 8 = 500 bytes/s per snapshot.
	c.mu.Lock()
	for i := 0; i < 60; i++ {
		c.recentHistory = append(c.recentHistory, Snapshot{
			DownloadBps: 8000,
			UploadBps:   4000,
			Timestamp:   time.Now().Add(time.Duration(-60+i) * time.Second),
		})
	}
	c.mu.Unlock()

	c.persistMinute()

	// Verify throughput_history has a row with expected totals.
	var dlBytes, ulBytes int64
	err := d.QueryRow("SELECT download_bytes, upload_bytes FROM throughput_history LIMIT 1").Scan(&dlBytes, &ulBytes)
	if err != nil {
		t.Fatalf("query throughput_history: %v", err)
	}
	// 60 snapshots * 1000 bytes = 60000
	if dlBytes != 60000 {
		t.Fatalf("expected 60000 download bytes in throughput_history, got %d", dlBytes)
	}
	// 60 snapshots * 500 bytes = 30000
	if ulBytes != 30000 {
		t.Fatalf("expected 30000 upload bytes in throughput_history, got %d", ulBytes)
	}

	// Verify usage_counters has session row.
	var sessionDl, sessionUl int64
	err = d.QueryRow("SELECT download_bytes, upload_bytes FROM usage_counters WHERE period = 'session'").Scan(&sessionDl, &sessionUl)
	if err != nil {
		t.Fatalf("query usage_counters session: %v", err)
	}
	if sessionDl != 60000 {
		t.Fatalf("expected 60000 session download bytes, got %d", sessionDl)
	}
	if sessionUl != 30000 {
		t.Fatalf("expected 30000 session upload bytes, got %d", sessionUl)
	}

	// Verify all_time counter exists too.
	var allTimeDl int64
	err = d.QueryRow("SELECT download_bytes FROM usage_counters WHERE period = 'all_time'").Scan(&allTimeDl)
	if err != nil {
		t.Fatalf("query usage_counters all_time: %v", err)
	}
	if allTimeDl != 60000 {
		t.Fatalf("expected 60000 all_time download bytes, got %d", allTimeDl)
	}
}

func TestSessionBytes_Empty(t *testing.T) {
	c, _ := testCollector(t)

	dl := c.SessionDownloadBytes()
	ul := c.SessionUploadBytes()
	if dl != 0 {
		t.Fatalf("expected 0 session download bytes, got %d", dl)
	}
	if ul != 0 {
		t.Fatalf("expected 0 session upload bytes, got %d", ul)
	}
}

func TestGetSessionStart(t *testing.T) {
	c, _ := testCollector(t)

	start := c.GetSessionStart()
	elapsed := time.Since(start)
	if elapsed >= 1*time.Second {
		t.Fatalf("session start should be very recent, but was %v ago", elapsed)
	}
}
