package scheduler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// EngineController is the interface the scheduler uses to start and stop
// the bandwidth saturation engines.
type EngineController interface {
	StartEngines(ctx context.Context, downloadMbps, uploadMbps int) error
	StopEngines()
	IsRunning() bool
}

// Schedule represents a recurring time window during which the engines
// should run at specified speeds.
type Schedule struct {
	ID           int    `json:"id"`
	DaysOfWeek   []int  `json:"daysOfWeek"` // 0=Sun .. 6=Sat
	StartTime    string `json:"startTime"`  // "HH:MM"
	EndTime      string `json:"endTime"`    // "HH:MM"
	DownloadMbps int    `json:"downloadMbps"`
	UploadMbps   int    `json:"uploadMbps"`
	Enabled      bool   `json:"enabled"`
}

// Override constants.
const (
	OverrideNone       = 0
	OverrideForceStart = 1
	OverrideForceStop  = 2
)

var ErrScheduleNotFound = errors.New("schedule not found")

// Scheduler evaluates schedules and manual overrides to control the engines.
type Scheduler struct {
	db         *sql.DB
	controller EngineController

	manualOverride     atomic.Int32
	mu                 sync.Mutex
	manualDownloadMbps int
	manualUploadMbps   int

	ctx    context.Context
	cancel context.CancelFunc

	// Track what the scheduler last applied so we avoid redundant
	// start/stop calls.
	lastAppliedDownload int
	lastAppliedUpload   int
}

// NewScheduler creates a Scheduler.
func NewScheduler(db *sql.DB, controller EngineController) *Scheduler {
	return &Scheduler{
		db:         db,
		controller: controller,
	}
}

// Start launches the scheduling loop.
func (s *Scheduler) Start(ctx context.Context) {
	s.ctx, s.cancel = context.WithCancel(ctx)
	go s.loop()
}

// Stop cancels the scheduling loop.
func (s *Scheduler) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
}

// ManualStart forces the engines to run at the given speeds, overriding
// any active schedule.
func (s *Scheduler) ManualStart(downloadMbps, uploadMbps int) {
	s.mu.Lock()
	s.manualDownloadMbps = downloadMbps
	s.manualUploadMbps = uploadMbps
	s.mu.Unlock()
	s.manualOverride.Store(int32(OverrideForceStart))
}

// ManualStop forces the engines to stop, overriding any active schedule.
func (s *Scheduler) ManualStop() {
	s.manualOverride.Store(int32(OverrideForceStop))
}

// ClearOverride returns to schedule-driven behaviour.
func (s *Scheduler) ClearOverride() {
	s.manualOverride.Store(int32(OverrideNone))
}

// GetOverrideState returns the current override: 0 (none), 1 (forceStart),
// or 2 (forceStop).
func (s *Scheduler) GetOverrideState() int {
	return int(s.manualOverride.Load())
}

// ---------- schedule CRUD ----------

// GetSchedules loads all schedules from the database.
func (s *Scheduler) GetSchedules() ([]Schedule, error) {
	rows, err := s.db.Query(
		"SELECT id, days_of_week, start_time, end_time, download_mbps, upload_mbps, enabled FROM schedules ORDER BY id",
	)
	if err != nil {
		return nil, fmt.Errorf("query schedules: %w", err)
	}
	defer rows.Close()

	var schedules []Schedule
	for rows.Next() {
		var sc Schedule
		var daysJSON string
		var enabled int
		if err := rows.Scan(&sc.ID, &daysJSON, &sc.StartTime, &sc.EndTime, &sc.DownloadMbps, &sc.UploadMbps, &enabled); err != nil {
			return nil, fmt.Errorf("scan schedule: %w", err)
		}
		if err := json.Unmarshal([]byte(daysJSON), &sc.DaysOfWeek); err != nil {
			return nil, fmt.Errorf("unmarshal days_of_week for schedule %d: %w", sc.ID, err)
		}
		sc.Enabled = enabled != 0
		schedules = append(schedules, sc)
	}
	return schedules, rows.Err()
}

// CreateSchedule inserts a new schedule and returns its ID.
func (s *Scheduler) CreateSchedule(sc Schedule) (int64, error) {
	if err := ValidateSchedule(sc); err != nil {
		return 0, err
	}
	daysJSON, err := json.Marshal(sc.DaysOfWeek)
	if err != nil {
		return 0, fmt.Errorf("marshal days_of_week: %w", err)
	}
	enabledInt := 0
	if sc.Enabled {
		enabledInt = 1
	}
	res, err := s.db.Exec(
		"INSERT INTO schedules (days_of_week, start_time, end_time, download_mbps, upload_mbps, enabled) VALUES (?, ?, ?, ?, ?, ?)",
		string(daysJSON), sc.StartTime, sc.EndTime, sc.DownloadMbps, sc.UploadMbps, enabledInt,
	)
	if err != nil {
		return 0, fmt.Errorf("insert schedule: %w", err)
	}
	return res.LastInsertId()
}

// UpdateSchedule updates an existing schedule by ID.
func (s *Scheduler) UpdateSchedule(sc Schedule) error {
	if err := ValidateSchedule(sc); err != nil {
		return err
	}
	daysJSON, err := json.Marshal(sc.DaysOfWeek)
	if err != nil {
		return fmt.Errorf("marshal days_of_week: %w", err)
	}
	enabledInt := 0
	if sc.Enabled {
		enabledInt = 1
	}
	res, err := s.db.Exec(
		"UPDATE schedules SET days_of_week = ?, start_time = ?, end_time = ?, download_mbps = ?, upload_mbps = ?, enabled = ? WHERE id = ?",
		string(daysJSON), sc.StartTime, sc.EndTime, sc.DownloadMbps, sc.UploadMbps, enabledInt, sc.ID,
	)
	if err != nil {
		return fmt.Errorf("update schedule %d: %w", sc.ID, err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("update schedule %d: %w", sc.ID, err)
	}
	if rows == 0 {
		return ErrScheduleNotFound
	}
	return nil
}

// DeleteSchedule removes a schedule by ID.
func (s *Scheduler) DeleteSchedule(id int) error {
	res, err := s.db.Exec("DELETE FROM schedules WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete schedule %d: %w", id, err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete schedule %d: %w", id, err)
	}
	if rows == 0 {
		return ErrScheduleNotFound
	}
	return nil
}

func ValidateSchedule(sc Schedule) error {
	if len(sc.DaysOfWeek) == 0 {
		return fmt.Errorf("daysOfWeek must contain at least one day")
	}
	seenDays := make(map[int]struct{}, len(sc.DaysOfWeek))
	for _, day := range sc.DaysOfWeek {
		if day < 0 || day > 6 {
			return fmt.Errorf("daysOfWeek values must be between 0 and 6")
		}
		seenDays[day] = struct{}{}
	}
	if len(seenDays) == 0 {
		return fmt.Errorf("daysOfWeek must contain at least one day")
	}
	if _, err := parseHHMM(sc.StartTime); err != nil {
		return fmt.Errorf("invalid startTime: %w", err)
	}
	if _, err := parseHHMM(sc.EndTime); err != nil {
		return fmt.Errorf("invalid endTime: %w", err)
	}
	if sc.StartTime == sc.EndTime {
		return fmt.Errorf("startTime and endTime must define a non-zero window")
	}
	if sc.DownloadMbps < 1 {
		return fmt.Errorf("downloadMbps must be at least 1")
	}
	if sc.UploadMbps < 1 {
		return fmt.Errorf("uploadMbps must be at least 1")
	}
	return nil
}

// ---------- internal ----------

func (s *Scheduler) loop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	// Run an immediate check before waiting for the first tick.
	s.tick()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.tick()
		}
	}
}

func (s *Scheduler) tick() {
	override := int(s.manualOverride.Load())

	switch override {
	case OverrideForceStop:
		if s.controller.IsRunning() {
			s.controller.StopEngines()
		}
		s.lastAppliedDownload = 0
		s.lastAppliedUpload = 0
		return

	case OverrideForceStart:
		s.mu.Lock()
		dl := s.manualDownloadMbps
		ul := s.manualUploadMbps
		s.mu.Unlock()

		if !s.controller.IsRunning() || s.lastAppliedDownload != dl || s.lastAppliedUpload != ul {
			if err := s.controller.StartEngines(s.ctx, dl, ul); err != nil {
				log.Printf("scheduler: manual start failed: %v", err)
				return
			}
			s.lastAppliedDownload = dl
			s.lastAppliedUpload = ul
		}
		return
	}

	// Schedule-driven mode.
	schedules, err := s.GetSchedules()
	if err != nil {
		log.Printf("scheduler: failed to load schedules: %v", err)
		return
	}

	now := time.Now()
	matched := findMatchingSchedule(schedules, now)

	if matched != nil {
		if !s.controller.IsRunning() || s.lastAppliedDownload != matched.DownloadMbps || s.lastAppliedUpload != matched.UploadMbps {
			if err := s.controller.StartEngines(s.ctx, matched.DownloadMbps, matched.UploadMbps); err != nil {
				log.Printf("scheduler: start engines for schedule %d failed: %v", matched.ID, err)
				return
			}
			s.lastAppliedDownload = matched.DownloadMbps
			s.lastAppliedUpload = matched.UploadMbps
		}
	} else {
		if s.controller.IsRunning() {
			s.controller.StopEngines()
		}
		s.lastAppliedDownload = 0
		s.lastAppliedUpload = 0
	}
}

// findMatchingSchedule returns the first enabled schedule whose day-of-week
// and time window match the given time, or nil if none match.
// Handles overnight spans (e.g. 23:00 - 06:00).
func findMatchingSchedule(schedules []Schedule, now time.Time) *Schedule {
	weekday := int(now.Weekday()) // 0=Sun
	nowMinutes := now.Hour()*60 + now.Minute()

	for i := range schedules {
		sc := &schedules[i]
		if !sc.Enabled {
			continue
		}

		startMin, err := parseHHMM(sc.StartTime)
		if err != nil {
			log.Printf("scheduler: invalid start_time %q in schedule %d: %v", sc.StartTime, sc.ID, err)
			continue
		}
		endMin, err := parseHHMM(sc.EndTime)
		if err != nil {
			log.Printf("scheduler: invalid end_time %q in schedule %d: %v", sc.EndTime, sc.ID, err)
			continue
		}

		if startMin <= endMin {
			// Same-day window, e.g. 09:00 - 17:00.
			if containsDay(sc.DaysOfWeek, weekday) && nowMinutes >= startMin && nowMinutes < endMin {
				return sc
			}
		} else {
			// Overnight window, e.g. 23:00 - 06:00.
			// The window starts on the scheduled day and ends on the next day.
			//
			// Case 1: we are in the late-night portion (>= startMin) on a scheduled day.
			if containsDay(sc.DaysOfWeek, weekday) && nowMinutes >= startMin {
				return sc
			}
			// Case 2: we are in the early-morning portion (< endMin) and the
			// *previous* day is a scheduled day.
			prevDay := (weekday + 6) % 7
			if containsDay(sc.DaysOfWeek, prevDay) && nowMinutes < endMin {
				return sc
			}
		}
	}
	return nil
}

// parseHHMM converts "HH:MM" to minutes since midnight.
func parseHHMM(s string) (int, error) {
	var h, m int
	if _, err := fmt.Sscanf(s, "%d:%d", &h, &m); err != nil {
		return 0, err
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, fmt.Errorf("out of range: %s", s)
	}
	return h*60 + m, nil
}

// containsDay returns true if day is in the slice.
func containsDay(days []int, day int) bool {
	for _, d := range days {
		if d == day {
			return true
		}
	}
	return false
}
