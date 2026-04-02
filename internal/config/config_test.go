package config

import (
	"database/sql"
	"sync"
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

func TestNew_Defaults(t *testing.T) {
	d := testDB(t)
	cfg := New(d)
	s := cfg.Get()

	if s.DefaultDownloadMbps != DefaultDownloadMbps {
		t.Errorf("DefaultDownloadMbps = %d, want %d", s.DefaultDownloadMbps, DefaultDownloadMbps)
	}
	if s.UploadMode != UploadModeHTTP {
		t.Errorf("UploadMode = %q, want %q", s.UploadMode, UploadModeHTTP)
	}
	if s.AutoMode != AutoModeReliable {
		t.Errorf("AutoMode = %q, want %q", s.AutoMode, AutoModeReliable)
	}
	if s.ThrottleThresholdPct != DefaultThrottleThreshold {
		t.Errorf("ThrottleThresholdPct = %d, want %d", s.ThrottleThresholdPct, DefaultThrottleThreshold)
	}
	if len(s.DownloadServers) == 0 {
		t.Error("DownloadServers should not be empty")
	}
	if len(s.UploadEndpoints) == 0 {
		t.Error("UploadEndpoints should not be empty")
	}
	if s.WebPort != DefaultWebPort {
		t.Errorf("WebPort = %d, want %d", s.WebPort, DefaultWebPort)
	}
	if s.DownloadConcurrency != DefaultDownloadConcurrency {
		t.Errorf("DownloadConcurrency = %d, want %d", s.DownloadConcurrency, DefaultDownloadConcurrency)
	}
	if s.UploadConcurrency != DefaultUploadConcurrency {
		t.Errorf("UploadConcurrency = %d, want %d", s.UploadConcurrency, DefaultUploadConcurrency)
	}
	if s.UploadChunkSizeMB != DefaultUploadChunkSizeMB {
		t.Errorf("UploadChunkSizeMB = %d, want %d", s.UploadChunkSizeMB, DefaultUploadChunkSizeMB)
	}
	if s.ThrottleWindowMin != DefaultThrottleWindowMin {
		t.Errorf("ThrottleWindowMin = %d, want %d", s.ThrottleWindowMin, DefaultThrottleWindowMin)
	}
}

func TestNew_NilDB(t *testing.T) {
	cfg := New(nil)
	s := cfg.Get()

	if s.DefaultDownloadMbps != DefaultDownloadMbps {
		t.Errorf("DefaultDownloadMbps = %d, want %d", s.DefaultDownloadMbps, DefaultDownloadMbps)
	}
	if s.UploadMode != UploadModeHTTP {
		t.Errorf("UploadMode = %q, want %q", s.UploadMode, UploadModeHTTP)
	}
	if len(s.DownloadServers) == 0 {
		t.Error("DownloadServers should not be empty with nil DB")
	}

	// Save should not crash with nil DB.
	if err := cfg.Save(); err != nil {
		t.Errorf("Save with nil DB: %v", err)
	}

	// Update should not crash with nil DB.
	err := cfg.Update(func(s *Snapshot) error {
		s.DefaultDownloadMbps = 9999
		return nil
	})
	if err != nil {
		t.Errorf("Update with nil DB: %v", err)
	}
	if got := cfg.Get().DefaultDownloadMbps; got != 9999 {
		t.Errorf("after Update, DefaultDownloadMbps = %d, want 9999", got)
	}
}

func TestUpdate_Persists(t *testing.T) {
	d := testDB(t)
	cfg := New(d)

	err := cfg.Update(func(s *Snapshot) error {
		s.DefaultDownloadMbps = 1234
		s.ThrottleThresholdPct = 75
		return nil
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	// Verify in-memory read-back.
	s := cfg.Get()
	if s.DefaultDownloadMbps != 1234 {
		t.Errorf("after Update, DefaultDownloadMbps = %d, want 1234", s.DefaultDownloadMbps)
	}
	if s.ThrottleThresholdPct != 75 {
		t.Errorf("after Update, ThrottleThresholdPct = %d, want 75", s.ThrottleThresholdPct)
	}

	// Create a new Config on the same DB to verify persistence.
	cfg2 := New(d)
	s2 := cfg2.Get()
	if s2.DefaultDownloadMbps != 1234 {
		t.Errorf("persisted DefaultDownloadMbps = %d, want 1234", s2.DefaultDownloadMbps)
	}
	if s2.ThrottleThresholdPct != 75 {
		t.Errorf("persisted ThrottleThresholdPct = %d, want 75", s2.ThrottleThresholdPct)
	}
}

func TestSetB2Credentials(t *testing.T) {
	d := testDB(t)
	cfg := New(d)

	cfg.SetB2Credentials("myKeyID", "myAppKey", "myBucket", "https://custom.endpoint.com")

	s := cfg.Get()
	if s.B2KeyID != "myKeyID" {
		t.Errorf("B2KeyID = %q, want %q", s.B2KeyID, "myKeyID")
	}
	if s.B2AppKey != "myAppKey" {
		t.Errorf("B2AppKey = %q, want %q", s.B2AppKey, "myAppKey")
	}
	if s.B2BucketName != "myBucket" {
		t.Errorf("B2BucketName = %q, want %q", s.B2BucketName, "myBucket")
	}
	if s.B2Endpoint != "https://custom.endpoint.com" {
		t.Errorf("B2Endpoint = %q, want %q", s.B2Endpoint, "https://custom.endpoint.com")
	}

	// Empty endpoint should preserve existing value.
	cfg.SetB2Credentials("k2", "a2", "b2", "")
	s = cfg.Get()
	if s.B2Endpoint != "https://custom.endpoint.com" {
		t.Errorf("B2Endpoint after empty override = %q, want preserved %q", s.B2Endpoint, "https://custom.endpoint.com")
	}
	if s.B2KeyID != "k2" {
		t.Errorf("B2KeyID = %q, want %q", s.B2KeyID, "k2")
	}
}

func TestSetSpeedTargets(t *testing.T) {
	d := testDB(t)
	cfg := New(d)

	cfg.SetSpeedTargets(2000, 800)

	s := cfg.Get()
	if s.DefaultDownloadMbps != 2000 {
		t.Errorf("DefaultDownloadMbps = %d, want 2000", s.DefaultDownloadMbps)
	}
	if s.DefaultUploadMbps != 800 {
		t.Errorf("DefaultUploadMbps = %d, want 800", s.DefaultUploadMbps)
	}
}

func TestSanitize_InvalidUploadMode(t *testing.T) {
	validModes := []string{UploadModeS3, UploadModeHTTP, UploadModeLocal}
	for _, mode := range validModes {
		if !isValidUploadMode(mode) {
			t.Errorf("isValidUploadMode(%q) = false, want true", mode)
		}
	}

	invalidModes := []string{"", "ftp", "invalid", "S3", "HTTP", "LOCAL"}
	for _, mode := range invalidModes {
		if isValidUploadMode(mode) {
			t.Errorf("isValidUploadMode(%q) = true, want false", mode)
		}
	}

	// Also check auto modes.
	if !isValidAutoMode(AutoModeReliable) {
		t.Error("isValidAutoMode(AutoModeReliable) = false, want true")
	}
	if !isValidAutoMode(AutoModeMax) {
		t.Error("isValidAutoMode(AutoModeMax) = false, want true")
	}
	if isValidAutoMode("turbo") {
		t.Error("isValidAutoMode(\"turbo\") = true, want false")
	}
	if isValidAutoMode("") {
		t.Error("isValidAutoMode(\"\") = true, want false")
	}
}

func TestCleanStringList_Dedupes(t *testing.T) {
	input := []string{
		"  http://a.com  ",
		"http://b.com",
		"http://a.com",
		"  http://c.com",
		"http://b.com  ",
		"   ",
		"",
	}
	result := cleanStringList(input)

	expected := []string{"http://a.com", "http://b.com", "http://c.com"}
	if len(result) != len(expected) {
		t.Fatalf("cleanStringList returned %d items, want %d: %v", len(result), len(expected), result)
	}
	for i, v := range expected {
		if result[i] != v {
			t.Errorf("result[%d] = %q, want %q", i, result[i], v)
		}
	}
}

func TestCleanStringList_Empty(t *testing.T) {
	if result := cleanStringList(nil); result != nil {
		t.Errorf("cleanStringList(nil) = %v, want nil", result)
	}
	if result := cleanStringList([]string{}); result != nil {
		t.Errorf("cleanStringList([]string{}) = %v, want nil", result)
	}
}

func TestConcurrentGetUpdate(t *testing.T) {
	d := testDB(t)
	cfg := New(d)

	var wg sync.WaitGroup

	// 100 concurrent Updates.
	for i := 0; i < 100; i++ {
		wg.Add(1)
		val := i
		go func() {
			defer wg.Done()
			_ = cfg.Update(func(s *Snapshot) error {
				s.DefaultDownloadMbps = val
				return nil
			})
		}()
	}

	// 100 concurrent Gets.
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s := cfg.Get()
			// Just ensure the snapshot is internally consistent and no panic occurs.
			if s.DefaultDownloadMbps < 0 {
				t.Errorf("unexpected negative DefaultDownloadMbps: %d", s.DefaultDownloadMbps)
			}
		}()
	}

	wg.Wait()

	// After all goroutines finish, one final Get should return a valid value.
	s := cfg.Get()
	if s.DefaultDownloadMbps < 0 || s.DefaultDownloadMbps > 99 {
		t.Errorf("final DefaultDownloadMbps = %d, want 0-99", s.DefaultDownloadMbps)
	}
}
