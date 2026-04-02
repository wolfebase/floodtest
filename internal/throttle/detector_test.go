package throttle

import (
	"database/sql"
	"testing"

	"wansaturator/internal/db"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.OpenDB(":memory:")
	if err != nil {
		t.Fatalf("OpenDB: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

// TestDetector_NoThrottleAboveThreshold verifies that 900Mbps with a 1Gbps
// target at 80% threshold produces no throttle events.
func TestDetector_NoThrottleAboveThreshold(t *testing.T) {
	d := testDB(t)
	rateProvider := func(windowSeconds int) (int64, int64) {
		return 900_000_000, 900_000_000
	}
	det := NewDetector(d, rateProvider, 80, 5)
	det.SetTargets(1_000_000_000, 1_000_000_000)

	det.check()

	var count int
	if err := d.QueryRow("SELECT COUNT(*) FROM throttle_events").Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 events, got %d", count)
	}
}

// TestDetector_ThrottleWhenBelowThreshold verifies that 500Mbps with a 1Gbps
// target creates two throttle events (one for download, one for upload).
func TestDetector_ThrottleWhenBelowThreshold(t *testing.T) {
	d := testDB(t)
	rateProvider := func(windowSeconds int) (int64, int64) {
		return 500_000_000, 500_000_000
	}
	det := NewDetector(d, rateProvider, 80, 5)
	det.SetTargets(1_000_000_000, 1_000_000_000)

	det.check()

	var count int
	if err := d.QueryRow("SELECT COUNT(*) FROM throttle_events").Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 events (dl+ul), got %d", count)
	}

	// Verify directions.
	rows, err := d.Query("SELECT direction, target_bps, actual_bps, duration_seconds FROM throttle_events ORDER BY direction")
	if err != nil {
		t.Fatalf("query rows: %v", err)
	}
	defer rows.Close()

	expected := []struct {
		direction string
		targetBps int64
		actualBps int64
		duration  int
	}{
		{"download", 1_000_000_000, 500_000_000, 0},
		{"upload", 1_000_000_000, 500_000_000, 0},
	}

	i := 0
	for rows.Next() {
		var dir string
		var target, actual int64
		var dur int
		if err := rows.Scan(&dir, &target, &actual, &dur); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if i >= len(expected) {
			t.Fatalf("too many rows")
		}
		if dir != expected[i].direction {
			t.Errorf("row %d: direction = %q, want %q", i, dir, expected[i].direction)
		}
		if target != expected[i].targetBps {
			t.Errorf("row %d: target_bps = %d, want %d", i, target, expected[i].targetBps)
		}
		if actual != expected[i].actualBps {
			t.Errorf("row %d: actual_bps = %d, want %d", i, actual, expected[i].actualBps)
		}
		if dur != expected[i].duration {
			t.Errorf("row %d: duration_seconds = %d, want %d", i, dur, expected[i].duration)
		}
		i++
	}
}

// TestDetector_ThrottleResolvesWhenRecovered creates throttle events, then
// recovers above threshold and verifies resolved_at is set.
func TestDetector_ThrottleResolvesWhenRecovered(t *testing.T) {
	d := testDB(t)

	throttled := true
	rateProvider := func(windowSeconds int) (int64, int64) {
		if throttled {
			return 500_000_000, 500_000_000
		}
		return 900_000_000, 900_000_000
	}

	det := NewDetector(d, rateProvider, 80, 5)
	det.SetTargets(1_000_000_000, 1_000_000_000)

	// First check: creates events.
	det.check()

	// Recover.
	throttled = false
	det.check()

	// All events should now have resolved_at set.
	var unresolvedCount int
	if err := d.QueryRow("SELECT COUNT(*) FROM throttle_events WHERE resolved_at IS NULL").Scan(&unresolvedCount); err != nil {
		t.Fatalf("query: %v", err)
	}
	if unresolvedCount != 0 {
		t.Fatalf("expected 0 unresolved events, got %d", unresolvedCount)
	}

	var resolvedCount int
	if err := d.QueryRow("SELECT COUNT(*) FROM throttle_events WHERE resolved_at IS NOT NULL").Scan(&resolvedCount); err != nil {
		t.Fatalf("query: %v", err)
	}
	if resolvedCount != 2 {
		t.Fatalf("expected 2 resolved events, got %d", resolvedCount)
	}
}

// TestDetector_UpdateDurationOnContinuedThrottle verifies that two consecutive
// checks while throttled increment the duration to 30.
func TestDetector_UpdateDurationOnContinuedThrottle(t *testing.T) {
	d := testDB(t)
	rateProvider := func(windowSeconds int) (int64, int64) {
		return 500_000_000, 500_000_000
	}
	det := NewDetector(d, rateProvider, 80, 5)
	det.SetTargets(1_000_000_000, 1_000_000_000)

	// First check: creates events with duration=0.
	det.check()
	// Second check: updates duration to 30.
	det.check()

	rows, err := d.Query("SELECT direction, duration_seconds FROM throttle_events ORDER BY direction")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()

	for rows.Next() {
		var dir string
		var dur int
		if err := rows.Scan(&dir, &dur); err != nil {
			t.Fatalf("scan: %v", err)
		}
		if dur != 30 {
			t.Errorf("direction %q: duration_seconds = %d, want 30", dir, dur)
		}
	}
}

// TestDetector_NoEventWhenZeroRate verifies that zero rate does not trigger
// throttle events (the avgBps > 0 guard).
func TestDetector_NoEventWhenZeroRate(t *testing.T) {
	d := testDB(t)
	rateProvider := func(windowSeconds int) (int64, int64) {
		return 0, 0
	}
	det := NewDetector(d, rateProvider, 80, 5)
	det.SetTargets(1_000_000_000, 1_000_000_000)

	det.check()

	var count int
	if err := d.QueryRow("SELECT COUNT(*) FROM throttle_events").Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 events for zero rate, got %d", count)
	}
}

// TestDetector_NoEventWhenZeroTarget verifies that zero target returns early
// without creating events.
func TestDetector_NoEventWhenZeroTarget(t *testing.T) {
	d := testDB(t)
	rateProvider := func(windowSeconds int) (int64, int64) {
		return 500_000_000, 500_000_000
	}
	det := NewDetector(d, rateProvider, 80, 5)
	// Targets default to zero; don't call SetTargets.

	det.check()

	var count int
	if err := d.QueryRow("SELECT COUNT(*) FROM throttle_events").Scan(&count); err != nil {
		t.Fatalf("query: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 events for zero target, got %d", count)
	}
}

// TestSetThreshold verifies that SetThreshold updates the threshold field.
func TestSetThreshold(t *testing.T) {
	d := testDB(t)
	det := NewDetector(d, nil, 80, 5)

	det.SetThreshold(90)

	det.mu.Lock()
	got := det.thresholdPct
	det.mu.Unlock()

	if got != 90 {
		t.Fatalf("thresholdPct = %d, want 90", got)
	}
}

// TestSetWindow verifies that SetWindow updates the window field.
func TestSetWindow(t *testing.T) {
	d := testDB(t)
	det := NewDetector(d, nil, 80, 5)

	det.SetWindow(10)

	det.mu.Lock()
	got := det.windowMinutes
	det.mu.Unlock()

	if got != 10 {
		t.Fatalf("windowMinutes = %d, want 10", got)
	}
}
