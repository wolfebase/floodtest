package download

import (
	"testing"
)

func TestNewServerList_DefaultServers(t *testing.T) {
	sl := NewServerList(DefaultServers)

	if sl.TotalCount() != len(DefaultServers) {
		t.Fatalf("expected %d servers, got %d", len(DefaultServers), sl.TotalCount())
	}

	// All servers should start healthy.
	statuses := sl.HealthStatus()
	for i, s := range statuses {
		if !s.Healthy {
			t.Errorf("server %d (%s) should be healthy on creation", i, s.URL)
		}
		if s.Blocked {
			t.Errorf("server %d (%s) should not be blocked on creation", i, s.URL)
		}
		if s.ConsecutiveFailures != 0 {
			t.Errorf("server %d (%s) should have 0 consecutive failures, got %d", i, s.URL, s.ConsecutiveFailures)
		}
	}

	if sl.HealthyCount() != len(DefaultServers) {
		t.Errorf("HealthyCount should be %d, got %d", len(DefaultServers), sl.HealthyCount())
	}
}

func TestServerList_MarkUnhealthy(t *testing.T) {
	urls := []string{"http://server1.test/file", "http://server2.test/file"}
	sl := NewServerList(urls)

	sl.MarkUnhealthy(urls[0], "connection refused")

	statuses := sl.HealthStatus()

	// Find server1 in the health status.
	var s1 ServerHealth
	for _, s := range statuses {
		if s.URL == urls[0] {
			s1 = s
			break
		}
	}

	if s1.ConsecutiveFailures != 1 {
		t.Errorf("expected consecutiveFailures=1, got %d", s1.ConsecutiveFailures)
	}
	if s1.TotalFailures != 1 {
		t.Errorf("expected totalFailures=1, got %d", s1.TotalFailures)
	}
	if s1.Healthy {
		t.Error("server should be unhealthy after MarkUnhealthy")
	}
	if s1.LastError != "connection refused" {
		t.Errorf("expected lastError='connection refused', got %q", s1.LastError)
	}

	// Server2 should still be healthy.
	var s2 ServerHealth
	for _, s := range statuses {
		if s.URL == urls[1] {
			s2 = s
			break
		}
	}
	if !s2.Healthy {
		t.Error("server2 should remain healthy")
	}
}

func TestServerList_MarkSuccess(t *testing.T) {
	urls := []string{"http://server1.test/file"}
	sl := NewServerList(urls)

	// Mark unhealthy first to set consecutiveFailures > 0.
	sl.MarkUnhealthy(urls[0], "timeout")

	statuses := sl.HealthStatus()
	if statuses[0].ConsecutiveFailures != 1 {
		t.Fatalf("expected 1 failure before success, got %d", statuses[0].ConsecutiveFailures)
	}

	// Now mark success — should reset consecutive failures.
	sl.MarkSuccess(urls[0])

	statuses = sl.HealthStatus()
	if statuses[0].ConsecutiveFailures != 0 {
		t.Errorf("expected consecutiveFailures=0 after MarkSuccess, got %d", statuses[0].ConsecutiveFailures)
	}
	if statuses[0].TotalDownloads != 1 {
		t.Errorf("expected totalDownloads=1 after MarkSuccess, got %d", statuses[0].TotalDownloads)
	}
}

func TestServerList_Next_SkipsUnhealthy(t *testing.T) {
	urls := []string{"http://server1.test/file", "http://server2.test/file"}
	sl := NewServerList(urls)

	// Mark server1 unhealthy 5 times (triggers auto-block at 5 failures).
	for i := 0; i < 5; i++ {
		sl.MarkUnhealthy(urls[0], "fail")
	}

	// Verify server1 is blocked.
	statuses := sl.HealthStatus()
	for _, s := range statuses {
		if s.URL == urls[0] {
			if !s.Blocked {
				t.Fatal("server1 should be blocked after 5 failures")
			}
			break
		}
	}

	// Next() should always return server2 since server1 is blocked.
	for i := 0; i < 10; i++ {
		got := sl.Next()
		if got != urls[1] {
			t.Errorf("iteration %d: expected Next() to return server2 (%s), got %s", i, urls[1], got)
		}
	}
}

func TestServerList_UnblockServer(t *testing.T) {
	urls := []string{"http://server1.test/file", "http://server2.test/file"}
	sl := NewServerList(urls)

	// Block server1 with 10 consecutive failures.
	for i := 0; i < 10; i++ {
		sl.MarkUnhealthy(urls[0], "fail")
	}

	// Verify it is blocked.
	statuses := sl.HealthStatus()
	var s1 ServerHealth
	for _, s := range statuses {
		if s.URL == urls[0] {
			s1 = s
			break
		}
	}
	if !s1.Blocked {
		t.Fatal("server1 should be blocked after 10 failures")
	}

	// Unblock the server.
	ok := sl.UnblockServer(urls[0])
	if !ok {
		t.Fatal("UnblockServer should return true for a known server")
	}

	// After unblocking, the server should no longer be blocked.
	// Note: UnblockServer puts it into cooldown state (not immediately healthy),
	// but the blocked flag should be cleared.
	statuses = sl.HealthStatus()
	for _, s := range statuses {
		if s.URL == urls[0] {
			if s.Blocked {
				t.Error("server1 should not be blocked after UnblockServer")
			}
			break
		}
	}

	// Unblocking an unknown server should return false.
	ok = sl.UnblockServer("http://nonexistent.test/file")
	if ok {
		t.Error("UnblockServer should return false for unknown server")
	}
}

func TestServerList_ResetCooldowns(t *testing.T) {
	urls := []string{
		"http://server1.test/file",
		"http://server2.test/file",
		"http://server3.test/file",
	}
	sl := NewServerList(urls)

	// Mark multiple servers unhealthy, including one blocked.
	sl.MarkUnhealthy(urls[0], "error1")
	sl.MarkUnhealthy(urls[0], "error1") // 2 failures

	for i := 0; i < 6; i++ { // 6 failures → blocked
		sl.MarkUnhealthy(urls[1], "error2")
	}

	sl.MarkUnhealthy(urls[2], "error3")

	// Verify pre-conditions.
	if sl.HealthyCount() != 0 {
		t.Fatalf("expected 0 healthy servers before reset, got %d", sl.HealthyCount())
	}

	statuses := sl.HealthStatus()
	for _, s := range statuses {
		if s.URL == urls[1] && !s.Blocked {
			t.Fatal("server2 should be blocked before reset")
		}
	}

	// Reset all cooldowns.
	sl.ResetCooldowns()

	// All servers should now be healthy and unblocked.
	if sl.HealthyCount() != len(urls) {
		t.Errorf("expected %d healthy servers after reset, got %d", len(urls), sl.HealthyCount())
	}

	statuses = sl.HealthStatus()
	for _, s := range statuses {
		if !s.Healthy {
			t.Errorf("server %s should be healthy after ResetCooldowns", s.URL)
		}
		if s.Blocked {
			t.Errorf("server %s should not be blocked after ResetCooldowns", s.URL)
		}
		if s.ConsecutiveFailures != 0 {
			t.Errorf("server %s should have 0 consecutive failures after ResetCooldowns, got %d", s.URL, s.ConsecutiveFailures)
		}
	}
}
