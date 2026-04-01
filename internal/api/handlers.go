package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
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
	OnStart func(downloadMbps, uploadMbps int) error
	OnStop  func()
	IsRunning func() bool
	GetDownloadStreams func() int
	GetUploadStreams   func() int
	GetSessionStart   func() time.Time
	GetSessionDownloadBytes func() int64
	GetSessionUploadBytes   func() int64
	GetCurrentDownloadBps   func() int64
	GetCurrentUploadBps     func() int64
	TestB2Connection        func(keyID, appKey, bucket, endpoint string) (bool, string)
	GetServerHealth         func() interface{}
	GetUpdateStatus         func() interface{}
	CheckForUpdate          func(ctx context.Context) (interface{}, error)
	ApplyUpdate             func(ctx context.Context) error
	SetAutoUpdate           func(enabled bool, schedule string) error
	GetUpdateHistory        func() interface{}
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
		"running":            running,
		"downloadBps":        dlBps,
		"uploadBps":          ulBps,
		"downloadStreams":     dlStreams,
		"uploadStreams":       ulStreams,
		"uptimeSeconds":      uptimeSeconds,
		"overrideState":      a.Scheduler.GetOverrideState(),
		"targetDownloadMbps": cfg.DefaultDownloadMbps,
		"targetUploadMbps":   cfg.DefaultUploadMbps,
	})
}

func (a *App) HandleStart(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DownloadMbps *int `json:"downloadMbps"`
		UploadMbps   *int `json:"uploadMbps"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	cfg := a.Config.Get()
	dlMbps := cfg.DefaultDownloadMbps
	ulMbps := cfg.DefaultUploadMbps
	if req.DownloadMbps != nil {
		dlMbps = *req.DownloadMbps
	}
	if req.UploadMbps != nil {
		ulMbps = *req.UploadMbps
	}

	a.Scheduler.ManualStart(dlMbps, ulMbps)
	if a.OnStart != nil {
		if err := a.OnStart(dlMbps, ulMbps); err != nil {
			writeError(w, 500, err.Error())
			return
		}
	}
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
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		writeError(w, 400, "invalid request body")
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
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		writeError(w, 400, "invalid request body")
		return
	}
	s.ID = id
	if err := a.Scheduler.UpdateSchedule(s); err != nil {
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
	var updates map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeError(w, 400, "invalid request body")
		return
	}

	cfg := a.Config

	if v, ok := updates["b2KeyId"]; ok {
		cfg.B2KeyID = fmt.Sprint(v)
	}
	if v, ok := updates["b2AppKey"]; ok {
		cfg.B2AppKey = fmt.Sprint(v)
	}
	if v, ok := updates["b2BucketName"]; ok {
		cfg.B2BucketName = fmt.Sprint(v)
	}
	if v, ok := updates["b2Endpoint"]; ok {
		cfg.B2Endpoint = fmt.Sprint(v)
	}
	if v, ok := updates["defaultDownloadMbps"]; ok {
		if n, err := toInt(v); err == nil {
			cfg.DefaultDownloadMbps = n
		}
	}
	if v, ok := updates["defaultUploadMbps"]; ok {
		if n, err := toInt(v); err == nil {
			cfg.DefaultUploadMbps = n
		}
	}
	if v, ok := updates["downloadConcurrency"]; ok {
		if n, err := toInt(v); err == nil {
			cfg.DownloadConcurrency = n
		}
	}
	if v, ok := updates["uploadConcurrency"]; ok {
		if n, err := toInt(v); err == nil {
			cfg.UploadConcurrency = n
		}
	}
	if v, ok := updates["uploadChunkSizeMb"]; ok {
		if n, err := toInt(v); err == nil {
			cfg.UploadChunkSizeMB = n
		}
	}
	if v, ok := updates["throttleThresholdPct"]; ok {
		if n, err := toInt(v); err == nil {
			cfg.ThrottleThresholdPct = n
		}
	}
	if v, ok := updates["throttleWindowMin"]; ok {
		if n, err := toInt(v); err == nil {
			cfg.ThrottleWindowMin = n
		}
	}
	if v, ok := updates["downloadServers"]; ok {
		if arr, ok := v.([]interface{}); ok {
			servers := make([]string, 0, len(arr))
			for _, s := range arr {
				servers = append(servers, fmt.Sprint(s))
			}
			cfg.DownloadServers = servers
		}
	}

	if err := cfg.Save(); err != nil {
		writeError(w, 500, err.Error())
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

func (a *App) HandleSetupRequired(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]bool{
		"required": a.Config.IsSetupRequired(),
	})
}

func toInt(v interface{}) (int, error) {
	switch val := v.(type) {
	case float64:
		return int(val), nil
	case string:
		return strconv.Atoi(val)
	case int:
		return val, nil
	default:
		return 0, fmt.Errorf("cannot convert %T to int", v)
	}
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
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "invalid request")
		return
	}
	if a.SetAutoUpdate != nil {
		a.SetAutoUpdate(req.Enabled, req.Schedule)
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
