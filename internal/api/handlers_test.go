package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"database/sql"

	"wansaturator/internal/config"
	"wansaturator/internal/db"
	"wansaturator/internal/scheduler"
)

// ---------- helpers ----------

type mockEngineController struct{}

func (m *mockEngineController) StartEngines(_ context.Context, _, _ int) error { return nil }
func (m *mockEngineController) StopEngines()                                   {}
func (m *mockEngineController) IsRunning() bool                                { return false }

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := db.OpenDB(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func testApp(t *testing.T) *App {
	t.Helper()
	d := testDB(t)
	cfg := config.New(d)
	ctrl := &mockEngineController{}
	sched := scheduler.NewScheduler(d, ctrl)
	return &App{
		DB: d, Config: cfg, Scheduler: sched, Hub: NewWsHub(),
		IsRunning:               func() bool { return false },
		GetDownloadStreams:       func() int { return 0 },
		GetUploadStreams:         func() int { return 0 },
		GetSessionStart:         func() time.Time { return time.Now() },
		GetSessionDownloadBytes: func() int64 { return 0 },
		GetSessionUploadBytes:   func() int64 { return 0 },
		GetCurrentDownloadBps:   func() int64 { return 0 },
		GetCurrentUploadBps:     func() int64 { return 0 },
		GetServerHealth:         func() interface{} { return []interface{}{} },
		GetUploadServerHealth:   func() interface{} { return []interface{}{} },
		GetUpdateStatus:         func() interface{} { return map[string]interface{}{"dockerAvailable": false} },
		GetUpdateHistory:        func() interface{} { return []interface{}{} },
	}
}

// ---------- handler tests ----------

func TestHandleStatus_ReturnsJSON(t *testing.T) {
	app := testApp(t)
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	rec := httptest.NewRecorder()

	app.HandleStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Fatalf("expected application/json, got %q", ct)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if _, ok := body["running"]; !ok {
		t.Fatal("response missing 'running' field")
	}
}

func TestHandleGetSettings_ReturnsDefaults(t *testing.T) {
	app := testApp(t)
	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	rec := httptest.NewRecorder()

	app.HandleGetSettings(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if mode, ok := body["uploadMode"]; !ok {
		t.Fatal("response missing 'uploadMode' field")
	} else if mode != "http" {
		t.Fatalf("expected uploadMode='http', got %q", mode)
	}
}

func TestHandleGetSchedules_Empty(t *testing.T) {
	app := testApp(t)
	req := httptest.NewRequest(http.MethodGet, "/api/schedules", nil)
	rec := httptest.NewRecorder()

	app.HandleGetSchedules(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body []interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("expected JSON array: %v", err)
	}
	if len(body) != 0 {
		t.Fatalf("expected empty array, got %d elements", len(body))
	}
}

func TestHandleCreateSchedule_Valid(t *testing.T) {
	app := testApp(t)
	payload := map[string]interface{}{
		"daysOfWeek":   []int{1, 2, 3, 4, 5},
		"startTime":    "09:00",
		"endTime":      "17:00",
		"downloadMbps": 100,
		"uploadMbps":   50,
		"enabled":      true,
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/schedules", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	app.HandleCreateSchedule(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if _, ok := resp["id"]; !ok {
		t.Fatal("response missing 'id' field")
	}
}

func TestHandleCreateSchedule_InvalidBody(t *testing.T) {
	app := testApp(t)
	payload := map[string]interface{}{
		"daysOfWeek":   []int{},
		"startTime":    "09:00",
		"endTime":      "17:00",
		"downloadMbps": 100,
		"uploadMbps":   50,
		"enabled":      true,
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/schedules", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	app.HandleCreateSchedule(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestHandleUsage_ReturnsJSON(t *testing.T) {
	app := testApp(t)
	req := httptest.NewRequest(http.MethodGet, "/api/usage", nil)
	rec := httptest.NewRecorder()

	app.HandleUsage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Fatalf("expected application/json, got %q", ct)
	}

	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	// Should contain period keys
	for _, key := range []string{"session", "today", "month", "allTime"} {
		if _, ok := body[key]; !ok {
			t.Errorf("response missing %q field", key)
		}
	}
}

func TestHandleServerHealth_ReturnsArray(t *testing.T) {
	app := testApp(t)
	req := httptest.NewRequest(http.MethodGet, "/api/server-health", nil)
	rec := httptest.NewRecorder()

	app.HandleServerHealth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body []interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("expected JSON array: %v", err)
	}
}

// ---------- validation helper tests ----------

func TestValidateAbsoluteURL_Valid(t *testing.T) {
	if err := validateAbsoluteURL("url", "https://example.com"); err != nil {
		t.Fatalf("expected no error for https://example.com, got: %v", err)
	}
	if err := validateAbsoluteURL("url", "http://example.com/path"); err != nil {
		t.Fatalf("expected no error for http://example.com/path, got: %v", err)
	}
}

func TestValidateAbsoluteURL_Invalid(t *testing.T) {
	cases := []struct {
		name  string
		value string
	}{
		{"not a url", "not-a-url"},
		{"ftp scheme", "ftp://example.com"},
		{"relative path", "/relative"},
		{"empty string", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateAbsoluteURL("url", tc.value); err == nil {
				t.Fatalf("expected error for %q, got nil", tc.value)
			}
		})
	}
}

func TestValidateMin(t *testing.T) {
	if err := validateMin("field", 5, 1); err != nil {
		t.Fatalf("5 >= 1 should pass, got: %v", err)
	}
	if err := validateMin("field", 1, 1); err != nil {
		t.Fatalf("1 >= 1 should pass, got: %v", err)
	}
	if err := validateMin("field", 0, 1); err == nil {
		t.Fatal("0 >= 1 should fail, got nil")
	}
}

func TestValidateRange(t *testing.T) {
	if err := validateRange("field", 50, 1, 100); err != nil {
		t.Fatalf("50 in [1,100] should pass, got: %v", err)
	}
	if err := validateRange("field", 1, 1, 100); err != nil {
		t.Fatalf("1 in [1,100] should pass, got: %v", err)
	}
	if err := validateRange("field", 100, 1, 100); err != nil {
		t.Fatalf("100 in [1,100] should pass, got: %v", err)
	}
	if err := validateRange("field", 0, 1, 100); err == nil {
		t.Fatal("0 in [1,100] should fail, got nil")
	}
	if err := validateRange("field", 101, 1, 100); err == nil {
		t.Fatal("101 in [1,100] should fail, got nil")
	}
}

func TestValidateUploadMode(t *testing.T) {
	for _, mode := range []string{"s3", "http", "local"} {
		if err := validateUploadMode(mode); err != nil {
			t.Fatalf("mode %q should be valid, got: %v", mode, err)
		}
	}
	if err := validateUploadMode("ftp"); err == nil {
		t.Fatal("mode 'ftp' should be invalid, got nil")
	}
}

func TestValidateAutoUpdateSchedule(t *testing.T) {
	// Valid schedules with enabled=true
	for _, sched := range []string{"daily", "weekly", "monthly"} {
		if err := validateAutoUpdateSchedule(true, sched); err != nil {
			t.Fatalf("enabled=true, schedule=%q should pass, got: %v", sched, err)
		}
	}
	// Empty schedule with enabled=true should fail
	if err := validateAutoUpdateSchedule(true, ""); err == nil {
		t.Fatal("enabled=true, schedule='' should fail, got nil")
	}
	// Empty schedule with enabled=false should pass
	if err := validateAutoUpdateSchedule(false, ""); err != nil {
		t.Fatalf("enabled=false, schedule='' should pass, got: %v", err)
	}
	// Invalid schedule string
	if err := validateAutoUpdateSchedule(true, "biweekly"); err == nil {
		t.Fatal("schedule='biweekly' should be invalid, got nil")
	}
}
