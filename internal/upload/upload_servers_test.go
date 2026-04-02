package upload

import (
	"testing"
)

func TestUpdateSpeedScore(t *testing.T) {
	sl := NewUploadServerList([]string{"http://a.com", "http://b.com"})

	// First sample
	sl.UpdateSpeedScore("http://a.com", 1e9)
	health := sl.HealthStatus()
	if health[0].SpeedBps != 1e9 {
		t.Errorf("expected 1e9, got %f", health[0].SpeedBps)
	}

	// Rolling average of 3 samples
	sl.UpdateSpeedScore("http://a.com", 2e9)
	sl.UpdateSpeedScore("http://a.com", 3e9)
	health = sl.HealthStatus()
	expected := (1e9 + 2e9 + 3e9) / 3
	if health[0].SpeedBps != expected {
		t.Errorf("expected %f, got %f", expected, health[0].SpeedBps)
	}

	// Window caps at 5 samples
	sl.UpdateSpeedScore("http://a.com", 4e9)
	sl.UpdateSpeedScore("http://a.com", 5e9)
	sl.UpdateSpeedScore("http://a.com", 6e9) // should push out 1e9
	health = sl.HealthStatus()
	expected = (2e9 + 3e9 + 4e9 + 5e9 + 6e9) / 5
	if health[0].SpeedBps != expected {
		t.Errorf("expected %f, got %f", expected, health[0].SpeedBps)
	}

	// Unknown URL is a no-op
	sl.UpdateSpeedScore("http://unknown.com", 999)
}
