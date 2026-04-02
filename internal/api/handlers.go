package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"wansaturator/internal/config"
	"wansaturator/internal/scheduler"
)

type App struct {
	DB        *sql.DB
	Config    *config.Config
	Scheduler *scheduler.Scheduler
	Hub       *WsHub

	// Callbacks set by main
	OnStart                 func(downloadMbps, uploadMbps int) error
	OnStop                  func()
	IsRunning               func() bool
	GetDownloadStreams      func() int
	GetUploadStreams        func() int
	GetSessionStart         func() time.Time
	GetSessionDownloadBytes func() int64
	GetSessionUploadBytes   func() int64
	GetCurrentDownloadBps   func() int64
	GetCurrentUploadBps     func() int64
	TestB2Connection        func(keyID, appKey, bucket, endpoint string) (bool, string)
	GetServerHealth         func() interface{}
	GetUploadServerHealth   func() interface{}
	RunSpeedTest            func(ctx context.Context) interface{}
	RunISPSpeedTest         func(ctx context.Context) (interface{}, error)
	UnblockServer           func(url string) bool
	UnblockAll              func() int
	GetUpdateStatus         func() interface{}
	CheckForUpdate          func(ctx context.Context) (interface{}, error)
	ApplyUpdate             func(ctx context.Context) error
	SetAutoUpdate           func(enabled bool, schedule string) error
	GetUpdateHistory        func() interface{}
}

type badRequestError struct {
	msg string
}

func (e *badRequestError) Error() string {
	return e.msg
}

type settingsUpdateRequest struct {
	B2KeyID              *string   `json:"b2KeyId"`
	B2AppKey             *string   `json:"b2AppKey"`
	B2BucketName         *string   `json:"b2BucketName"`
	B2Endpoint           *string   `json:"b2Endpoint"`
	DefaultDownloadMbps  *int      `json:"defaultDownloadMbps"`
	DefaultUploadMbps    *int      `json:"defaultUploadMbps"`
	DownloadConcurrency  *int      `json:"downloadConcurrency"`
	UploadConcurrency    *int      `json:"uploadConcurrency"`
	UploadChunkSizeMB    *int      `json:"uploadChunkSizeMb"`
	ThrottleThresholdPct *int      `json:"throttleThresholdPct"`
	ThrottleWindowMin    *int      `json:"throttleWindowMin"`
	DownloadServers      *[]string `json:"downloadServers"`
	UploadMode           *string   `json:"uploadMode"`
	UploadEndpoints      *[]string `json:"uploadEndpoints"`
	AutoMode             *string   `json:"autoMode"`
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func newBadRequestError(format string, args ...interface{}) error {
	return &badRequestError{msg: fmt.Sprintf(format, args...)}
}

func isBadRequest(err error) bool {
	var target *badRequestError
	return errors.As(err, &target)
}

func decodeJSONBody(r *http.Request, dst interface{}, allowEmpty bool) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(dst); err != nil {
		if allowEmpty && errors.Is(err, io.EOF) {
			return nil
		}
		return newBadRequestError("invalid request body")
	}

	var extra struct{}
	if err := decoder.Decode(&extra); err != io.EOF {
		return newBadRequestError("invalid request body")
	}
	return nil
}

func cleanURLList(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		cleaned = append(cleaned, value)
	}
	return cleaned
}

func validateAbsoluteURL(fieldName, value string) error {
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Host == "" {
		return newBadRequestError("%s must be a valid URL", fieldName)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return newBadRequestError("%s must use http or https", fieldName)
	}
	return nil
}

func validateURLList(fieldName string, values []string) ([]string, error) {
	cleaned := cleanURLList(values)
	if len(cleaned) == 0 {
		return nil, newBadRequestError("%s must contain at least one URL", fieldName)
	}
	for _, value := range cleaned {
		if err := validateAbsoluteURL(fieldName, value); err != nil {
			return nil, err
		}
	}
	return cleaned, nil
}

func validateMin(fieldName string, value, min int) error {
	if value < min {
		return newBadRequestError("%s must be at least %d", fieldName, min)
	}
	return nil
}

func validateRange(fieldName string, value, min, max int) error {
	if value < min || value > max {
		return newBadRequestError("%s must be between %d and %d", fieldName, min, max)
	}
	return nil
}

func validateUploadMode(mode string) error {
	switch mode {
	case config.UploadModeS3, config.UploadModeHTTP, config.UploadModeLocal:
		return nil
	default:
		return newBadRequestError("uploadMode must be one of %q, %q, or %q", config.UploadModeS3, config.UploadModeHTTP, config.UploadModeLocal)
	}
}

func validateAutoMode(mode string) error {
	switch mode {
	case config.AutoModeReliable, config.AutoModeMax:
		return nil
	default:
		return newBadRequestError("autoMode must be one of %q or %q", config.AutoModeReliable, config.AutoModeMax)
	}
}

func validateAutoUpdateSchedule(enabled bool, schedule string) error {
	if schedule == "" {
		if enabled {
			return newBadRequestError("schedule is required when auto-update is enabled")
		}
		return nil
	}
	switch schedule {
	case "daily", "weekly", "monthly":
		return nil
	default:
		return newBadRequestError("schedule must be one of %q, %q, or %q", "daily", "weekly", "monthly")
	}
}

func validateSettingsSnapshot(cfg *config.Snapshot) error {
	if err := validateMin("defaultDownloadMbps", cfg.DefaultDownloadMbps, 1); err != nil {
		return err
	}
	if err := validateMin("defaultUploadMbps", cfg.DefaultUploadMbps, 1); err != nil {
		return err
	}
	if err := validateMin("downloadConcurrency", cfg.DownloadConcurrency, 1); err != nil {
		return err
	}
	if err := validateMin("uploadConcurrency", cfg.UploadConcurrency, 1); err != nil {
		return err
	}
	if err := validateMin("uploadChunkSizeMb", cfg.UploadChunkSizeMB, 1); err != nil {
		return err
	}
	if err := validateRange("throttleThresholdPct", cfg.ThrottleThresholdPct, 1, 100); err != nil {
		return err
	}
	if err := validateMin("throttleWindowMin", cfg.ThrottleWindowMin, 1); err != nil {
		return err
	}
	if err := validateUploadMode(cfg.UploadMode); err != nil {
		return err
	}
	if err := validateAutoMode(cfg.AutoMode); err != nil {
		return err
	}

	servers, err := validateURLList("downloadServers", cfg.DownloadServers)
	if err != nil {
		return err
	}
	cfg.DownloadServers = servers

	if cfg.UploadMode == config.UploadModeHTTP {
		endpoints, err := validateURLList("uploadEndpoints", cfg.UploadEndpoints)
		if err != nil {
			return err
		}
		cfg.UploadEndpoints = endpoints
	} else if len(cfg.UploadEndpoints) > 0 {
		endpoints, err := validateURLList("uploadEndpoints", cfg.UploadEndpoints)
		if err != nil {
			return err
		}
		cfg.UploadEndpoints = endpoints
	}

	if cfg.B2Endpoint != "" {
		if err := validateAbsoluteURL("b2Endpoint", cfg.B2Endpoint); err != nil {
			return err
		}
	}
	if cfg.UploadMode == config.UploadModeS3 && cfg.B2Endpoint == "" {
		return newBadRequestError("b2Endpoint is required when uploadMode is %q", config.UploadModeS3)
	}

	return nil
}

func (a *App) HandleStatus(w http.ResponseWriter, r *http.Request) {
	cfg := a.Config.Get()
	running := false
	if a.IsRunning != nil {
		running = a.IsRunning()
	}
	var uptimeSeconds int64
	if running && a.GetSessionStart != nil {
		uptimeSeconds = int64(time.Since(a.GetSessionStart()).Seconds())
	}
	dlStreams := 0
	if a.GetDownloadStreams != nil {
		dlStreams = a.GetDownloadStreams()
	}
	ulStreams := 0
	if a.GetUploadStreams != nil {
		ulStreams = a.GetUploadStreams()
	}

	var dlBps, ulBps int64
	if running {
		if a.GetCurrentDownloadBps != nil {
			dlBps = a.GetCurrentDownloadBps()
		}
		if a.GetCurrentUploadBps != nil {
			ulBps = a.GetCurrentUploadBps()
		}
	}

	writeJSON(w, map[string]interface{}{
		"running":              running,
		"downloadBps":          dlBps,
		"uploadBps":            ulBps,
		"downloadStreams":      dlStreams,
		"uploadStreams":        ulStreams,
		"uptimeSeconds":        uptimeSeconds,
		"overrideState":        a.Scheduler.GetOverrideState(),
		"targetDownloadMbps":   cfg.DefaultDownloadMbps,
		"targetUploadMbps":     cfg.DefaultUploadMbps,
		"autoMode":             cfg.AutoMode,
		"measuredDownloadMbps": cfg.MeasuredDownloadMbps,
		"measuredUploadMbps":   cfg.MeasuredUploadMbps,
	})
}

func (a *App) HandleStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DownloadMbps *int `json:"downloadMbps"`
		UploadMbps   *int `json:"uploadMbps"`
	}
	if err := decodeJSONBody(r, &req, true); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	cfg := a.Config.Get()
	dlMbps := cfg.DefaultDownloadMbps
	ulMbps := cfg.DefaultUploadMbps
	if req.DownloadMbps != nil {
		if err := validateMin("downloadMbps", *req.DownloadMbps, 1); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		dlMbps = *req.DownloadMbps
	}
	if req.UploadMbps != nil {
		if err := validateMin("uploadMbps", *req.UploadMbps, 1); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		ulMbps = *req.UploadMbps
	}

	if a.OnStart != nil {
		if err := a.OnStart(dlMbps, ulMbps); err != nil {
			writeError(w, 500, err.Error())
			return
		}
	}
	a.Scheduler.ManualStart(dlMbps, ulMbps)
	writeJSON(w, map[string]string{"status": "started"})
}

func (a *App) HandleStop(w http.ResponseWriter, r *http.Request) {
	a.Scheduler.ManualStop()
	if a.OnStop != nil {
		a.OnStop()
	}
	writeJSON(w, map[string]string{"status": "stopped"})
}

func (a *App) HandleHistory(w http.ResponseWriter, r *http.Request) {
	rangeParam := r.URL.Query().Get("range")
	var since time.Time
	switch rangeParam {
	case "7d":
		since = time.Now().Add(-7 * 24 * time.Hour)
	case "30d":
		since = time.Now().Add(-30 * 24 * time.Hour)
	case "90d":
		since = time.Now().Add(-90 * 24 * time.Hour)
	default:
		since = time.Now().Add(-24 * time.Hour)
	}

	rows, err := a.DB.Query(
		"SELECT timestamp, download_bytes, upload_bytes FROM throughput_history WHERE timestamp >= ? ORDER BY timestamp",
		since.Format(time.RFC3339),
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	type Point struct {
		Timestamp   string `json:"timestamp"`
		DownloadBps int64  `json:"downloadBps"`
		UploadBps   int64  `json:"uploadBps"`
	}
	var points []Point
	for rows.Next() {
		var ts string
		var dlBytes, ulBytes int64
		if err := rows.Scan(&ts, &dlBytes, &ulBytes); err != nil {
			continue
		}
		// Convert bytes-per-minute to bits-per-second
		points = append(points, Point{
			Timestamp:   ts,
			DownloadBps: dlBytes * 8 / 60,
			UploadBps:   ulBytes * 8 / 60,
		})
	}
	if points == nil {
		points = []Point{}
	}
	writeJSON(w, points)
}

func (a *App) HandleUsage(w http.ResponseWriter, r *http.Request) {
	type Counter struct {
		DownloadBytes int64 `json:"downloadBytes"`
		UploadBytes   int64 `json:"uploadBytes"`
	}

	load := func(period string) Counter {
		var dl, ul int64
		a.DB.QueryRow(
			"SELECT download_bytes, upload_bytes FROM usage_counters WHERE period = ?",
			period,
		).Scan(&dl, &ul)
		return Counter{dl, ul}
	}

	today := time.Now().Format("2006-01-02")
	month := time.Now().Format("2006-01")

	writeJSON(w, map[string]Counter{
		"session": load("session"),
		"today":   load(today),
		"month":   load(month),
		"allTime": load("all_time"),
	})
}

func (a *App) HandleThrottleEvents(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(
		"SELECT id, timestamp, direction, target_bps, actual_bps, duration_seconds, resolved_at FROM throttle_events ORDER BY timestamp DESC LIMIT 200",
	)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	defer rows.Close()

	type Event struct {
		ID              int     `json:"id"`
		Timestamp       string  `json:"timestamp"`
		Direction       string  `json:"direction"`
		TargetBps       int64   `json:"targetBps"`
		ActualBps       int64   `json:"actualBps"`
		DurationSeconds int     `json:"durationSeconds"`
		ResolvedAt      *string `json:"resolvedAt"`
	}
	var events []Event
	for rows.Next() {
		var e Event
		var resolvedAt sql.NullString
		if err := rows.Scan(&e.ID, &e.Timestamp, &e.Direction, &e.TargetBps, &e.ActualBps, &e.DurationSeconds, &resolvedAt); err != nil {
			continue
		}
		if resolvedAt.Valid {
			e.ResolvedAt = &resolvedAt.String
		}
		events = append(events, e)
	}
	if events == nil {
		events = []Event{}
	}
	writeJSON(w, events)
}

func (a *App) HandleGetSchedules(w http.ResponseWriter, r *http.Request) {
	schedules, err := a.Scheduler.GetSchedules()
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	if schedules == nil {
		schedules = []scheduler.Schedule{}
	}
	writeJSON(w, schedules)
}

func (a *App) HandleCreateSchedule(w http.ResponseWriter, r *http.Request) {
	var s scheduler.Schedule
	if err := decodeJSONBody(r, &s, false); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := scheduler.ValidateSchedule(s); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, err := a.Scheduler.CreateSchedule(s)
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]int64{"id": id})
}

func (a *App) HandleUpdateSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		writeError(w, 400, "invalid id")
		return
	}

	var s scheduler.Schedule
	if err := decodeJSONBody(r, &s, false); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := scheduler.ValidateSchedule(s); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.ID = id
	if err := a.Scheduler.UpdateSchedule(s); err != nil {
		if errors.Is(err, scheduler.ErrScheduleNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "updated"})
}

func (a *App) HandleDeleteSchedule(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		writeError(w, 400, "invalid id")
		return
	}
	if err := a.Scheduler.DeleteSchedule(id); err != nil {
		if errors.Is(err, scheduler.ErrScheduleNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "deleted"})
}

func (a *App) HandleGetSettings(w http.ResponseWriter, r *http.Request) {
	cfg := a.Config.Get()
	writeJSON(w, cfg)
}

func (a *App) HandleUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var updates settingsUpdateRequest
	if err := decodeJSONBody(r, &updates, false); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	err := a.Config.Update(func(cfg *config.Snapshot) error {
		if updates.B2KeyID != nil {
			cfg.B2KeyID = strings.TrimSpace(*updates.B2KeyID)
		}
		if updates.B2AppKey != nil {
			cfg.B2AppKey = strings.TrimSpace(*updates.B2AppKey)
		}
		if updates.B2BucketName != nil {
			cfg.B2BucketName = strings.TrimSpace(*updates.B2BucketName)
		}
		if updates.B2Endpoint != nil {
			cfg.B2Endpoint = strings.TrimSpace(*updates.B2Endpoint)
		}
		if updates.DefaultDownloadMbps != nil {
			if err := validateMin("defaultDownloadMbps", *updates.DefaultDownloadMbps, 1); err != nil {
				return err
			}
			cfg.DefaultDownloadMbps = *updates.DefaultDownloadMbps
		}
		if updates.DefaultUploadMbps != nil {
			if err := validateMin("defaultUploadMbps", *updates.DefaultUploadMbps, 1); err != nil {
				return err
			}
			cfg.DefaultUploadMbps = *updates.DefaultUploadMbps
		}
		if updates.DownloadConcurrency != nil {
			if err := validateMin("downloadConcurrency", *updates.DownloadConcurrency, 1); err != nil {
				return err
			}
			cfg.DownloadConcurrency = *updates.DownloadConcurrency
		}
		if updates.UploadConcurrency != nil {
			if err := validateMin("uploadConcurrency", *updates.UploadConcurrency, 1); err != nil {
				return err
			}
			cfg.UploadConcurrency = *updates.UploadConcurrency
		}
		if updates.UploadChunkSizeMB != nil {
			if err := validateMin("uploadChunkSizeMb", *updates.UploadChunkSizeMB, 1); err != nil {
				return err
			}
			cfg.UploadChunkSizeMB = *updates.UploadChunkSizeMB
		}
		if updates.ThrottleThresholdPct != nil {
			if err := validateRange("throttleThresholdPct", *updates.ThrottleThresholdPct, 1, 100); err != nil {
				return err
			}
			cfg.ThrottleThresholdPct = *updates.ThrottleThresholdPct
		}
		if updates.ThrottleWindowMin != nil {
			if err := validateMin("throttleWindowMin", *updates.ThrottleWindowMin, 1); err != nil {
				return err
			}
			cfg.ThrottleWindowMin = *updates.ThrottleWindowMin
		}
		if updates.DownloadServers != nil {
			servers, err := validateURLList("downloadServers", *updates.DownloadServers)
			if err != nil {
				return err
			}
			cfg.DownloadServers = servers
		}
		if updates.UploadMode != nil {
			mode := strings.TrimSpace(*updates.UploadMode)
			if err := validateUploadMode(mode); err != nil {
				return err
			}
			cfg.UploadMode = mode
		}
		if updates.UploadEndpoints != nil {
			endpoints := cleanURLList(*updates.UploadEndpoints)
			for _, endpoint := range endpoints {
				if err := validateAbsoluteURL("uploadEndpoints", endpoint); err != nil {
					return err
				}
			}
			cfg.UploadEndpoints = endpoints
		}
		if updates.AutoMode != nil {
			mode := strings.TrimSpace(*updates.AutoMode)
			if err := validateAutoMode(mode); err != nil {
				return err
			}
			cfg.AutoMode = mode
		}
		return validateSettingsSnapshot(cfg)
	})
	if err != nil {
		if isBadRequest(err) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "saved"})
}

func (a *App) HandleTestB2(w http.ResponseWriter, r *http.Request) {
	cfg := a.Config.Get()
	if cfg.B2KeyID == "" || cfg.B2AppKey == "" || cfg.B2BucketName == "" {
		writeJSON(w, map[string]interface{}{
			"success": false,
			"message": "B2 credentials not configured",
		})
		return
	}

	if a.TestB2Connection != nil {
		success, msg := a.TestB2Connection(cfg.B2KeyID, cfg.B2AppKey, cfg.B2BucketName, cfg.B2Endpoint)
		writeJSON(w, map[string]interface{}{
			"success": success,
			"message": msg,
		})
		return
	}

	writeJSON(w, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Credentials configured for bucket: %s", cfg.B2BucketName),
	})
}

func (a *App) HandleServerHealth(w http.ResponseWriter, r *http.Request) {
	if a.GetServerHealth != nil {
		writeJSON(w, a.GetServerHealth())
	} else {
		writeJSON(w, []struct{}{})
	}
}

func (a *App) HandleUploadSink(w http.ResponseWriter, r *http.Request) {
	io.Copy(io.Discard, r.Body)
	r.Body.Close()
	w.WriteHeader(http.StatusOK)
}

func (a *App) HandleUploadServerHealth(w http.ResponseWriter, r *http.Request) {
	if a.GetUploadServerHealth != nil {
		writeJSON(w, a.GetUploadServerHealth())
	} else {
		writeJSON(w, []struct{}{})
	}
}

func (a *App) HandleUnblockServer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := decodeJSONBody(r, &req, false); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url is required")
		return
	}
	if err := validateAbsoluteURL("url", req.URL); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if a.UnblockServer != nil && a.UnblockServer(req.URL) {
		writeJSON(w, map[string]string{"status": "unblocked"})
	} else {
		writeError(w, 404, "server not found")
	}
}

func (a *App) HandleUnblockAll(w http.ResponseWriter, r *http.Request) {
	count := 0
	if a.UnblockAll != nil {
		count = a.UnblockAll()
	}
	writeJSON(w, map[string]interface{}{"status": "unblocked", "count": count})
}

func (a *App) HandleSpeedTest(w http.ResponseWriter, r *http.Request) {
	if a.RunSpeedTest == nil {
		writeError(w, 503, "speed test not available")
		return
	}
	results := a.RunSpeedTest(r.Context())
	writeJSON(w, results)
}

func (a *App) HandleISPSpeedTest(w http.ResponseWriter, r *http.Request) {
	if a.RunISPSpeedTest == nil {
		writeError(w, 503, "ISP speed test not available")
		return
	}
	result, err := a.RunISPSpeedTest(r.Context())
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, result)
}

func (a *App) HandleSetupRequired(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]bool{
		"required": a.Config.IsSetupRequired(),
	})
}

func (a *App) HandleUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if a.GetUpdateStatus != nil {
		writeJSON(w, a.GetUpdateStatus())
	} else {
		writeJSON(w, map[string]interface{}{"dockerAvailable": false})
	}
}

func (a *App) HandleCheckUpdate(w http.ResponseWriter, r *http.Request) {
	if a.CheckForUpdate == nil {
		writeError(w, 503, "updates not available")
		return
	}
	status, err := a.CheckForUpdate(r.Context())
	if err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, status)
}

func (a *App) HandleApplyUpdate(w http.ResponseWriter, r *http.Request) {
	if a.ApplyUpdate == nil {
		writeError(w, 503, "updates not available")
		return
	}
	if err := a.ApplyUpdate(r.Context()); err != nil {
		writeError(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]string{"status": "updating"})
}

func (a *App) HandleSetAutoUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled  bool   `json:"enabled"`
		Schedule string `json:"schedule"`
	}
	if err := decodeJSONBody(r, &req, false); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	req.Schedule = strings.TrimSpace(req.Schedule)
	if err := validateAutoUpdateSchedule(req.Enabled, req.Schedule); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if a.SetAutoUpdate != nil {
		if err := a.SetAutoUpdate(req.Enabled, req.Schedule); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, map[string]string{"status": "saved"})
}

func (a *App) HandleUpdateHistory(w http.ResponseWriter, r *http.Request) {
	if a.GetUpdateHistory != nil {
		writeJSON(w, a.GetUpdateHistory())
	} else {
		writeJSON(w, []struct{}{})
	}
}

// LoggingMiddleware logs HTTP requests
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if r.URL.Path != "/ws" {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start))
		}
	})
}
