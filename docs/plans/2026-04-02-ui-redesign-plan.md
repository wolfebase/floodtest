# UI Redesign — "Forge" Theme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete visual redesign of all pages from blue/teal corporate to an automotive performance aesthetic (amber/crimson on carbon black), plus backend data enrichment for ISP test history, daily usage, peak speeds, and next scheduled event.

**Architecture:** Theme-first refactor — define design tokens in Tailwind config, install Geist fonts, then sweep all components. Backend adds 1 new DB table, 2 new API endpoints, and enriches existing status/WebSocket responses. No component library or chart library changes.

**Tech Stack:** React 18, TypeScript, Tailwind 3.4, Recharts 2.15, Geist fonts, lucide-react icons, Go 1.22 backend

---

## Phase 1: Foundation (Tailwind Theme, Fonts, Dependencies)

### Task 1: Install npm dependencies

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install Geist fonts and lucide-react**

```bash
cd frontend && npm install @fontsource-variable/geist @fontsource-variable/geist-mono lucide-react
```

**Step 2: Verify installation**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: add Geist fonts and lucide-react dependencies"
```

---

### Task 2: Configure Geist fonts

**Files:**
- Modify: `frontend/src/index.css` (lines 1-22)
- Modify: `frontend/index.html` (lines 1-13)

**Step 1: Update index.css to import Geist fonts and set font families**

Replace the entire `frontend/src/index.css` with:

```css
@import '@fontsource-variable/geist';
@import '@fontsource-variable/geist-mono';

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    font-family: 'Geist Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  
  .font-mono {
    font-family: 'Geist Mono Variable', 'JetBrains Mono', 'Fira Code', monospace;
  }
}

/* Scrollbar styling */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #18181b; }
::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #52525b; }
```

**Step 2: Verify fonts load**

```bash
cd frontend && npm run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: configure Geist Sans and Geist Mono fonts"
```

---

### Task 3: Create Tailwind Forge theme

**Files:**
- Modify: `frontend/tailwind.config.js` (currently 9 lines, no extensions)

**Step 1: Replace tailwind.config.js with the Forge theme**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        forge: {
          base: '#09090b',
          surface: '#18181b',
          raised: '#27272a',
          inset: '#0f0f11',
          border: '#27272a',
          'border-subtle': '#1e1e22',
          'border-strong': '#3f3f46',
        },
      },
      fontFamily: {
        sans: ['"Geist Variable"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"Geist Mono Variable"', '"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [],
}
```

**Step 2: Verify config**

```bash
cd frontend && npm run build
```
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/tailwind.config.js
git commit -m "feat: add Forge color tokens and Geist font families to Tailwind"
```

---

## Phase 2: Backend Additions

### Task 4: Add speedtest_history table migration

**Files:**
- Modify: `internal/db/migrations.go`

**Step 1: Write the failing test**

Create `internal/db/speedtest_history_test.go`:

```go
package db_test

import (
    "database/sql"
    "testing"
    "time"

    "github.com/wolfebase/floodtest/internal/db"
)

func TestSpeedtestHistoryTable(t *testing.T) {
    d := db.OpenDB(":memory:")
    defer d.Close()

    // Insert a speedtest result
    _, err := d.Exec(
        `INSERT INTO speedtest_history (timestamp, download_mbps, upload_mbps, streams) VALUES (?, ?, ?, ?)`,
        time.Now().UTC().Format(time.RFC3339), 3452.5, 3452.5, 16,
    )
    if err != nil {
        t.Fatalf("insert speedtest_history: %v", err)
    }

    // Query it back
    var dlMbps, ulMbps float64
    var streams int
    err = d.QueryRow(`SELECT download_mbps, upload_mbps, streams FROM speedtest_history ORDER BY id DESC LIMIT 1`).
        Scan(&dlMbps, &ulMbps, &streams)
    if err != nil {
        t.Fatalf("query speedtest_history: %v", err)
    }
    if dlMbps != 3452.5 || ulMbps != 3452.5 || streams != 16 {
        t.Fatalf("got dl=%.1f ul=%.1f streams=%d, want 3452.5/3452.5/16", dlMbps, ulMbps, streams)
    }
}
```

**Step 2: Run test to verify it fails**

```bash
go test -run TestSpeedtestHistoryTable ./internal/db/
```
Expected: FAIL (table doesn't exist)

**Step 3: Add the migration**

In `internal/db/migrations.go`, add to the migrations slice:

```go
{
    Version: <next_version>,
    SQL: `CREATE TABLE IF NOT EXISTS speedtest_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        download_mbps REAL NOT NULL,
        upload_mbps REAL NOT NULL,
        streams INTEGER NOT NULL DEFAULT 16
    );
    CREATE INDEX IF NOT EXISTS idx_speedtest_history_timestamp ON speedtest_history(timestamp);`,
},
```

**Step 4: Run test to verify it passes**

```bash
go test -run TestSpeedtestHistoryTable ./internal/db/
```
Expected: PASS

**Step 5: Commit**

```bash
git add internal/db/migrations.go internal/db/speedtest_history_test.go
git commit -m "feat: add speedtest_history table for ISP test results"
```

---

### Task 5: Store ISP speed test results in history table

**Files:**
- Modify: `internal/speedtest/speedtest.go`
- Modify: `cmd/server/main.go` (where ISP test is called)

**Step 1: Write the test**

Create `internal/speedtest/history_test.go`:

```go
package speedtest_test

import (
    "testing"
    "time"

    "github.com/wolfebase/floodtest/internal/db"
    "github.com/wolfebase/floodtest/internal/speedtest"
)

func TestSaveResult(t *testing.T) {
    d := db.OpenDB(":memory:")
    defer d.Close()

    result := speedtest.Result{
        DownloadMbps: 3452.5,
        UploadMbps:   3100.0,
        Timestamp:    time.Now(),
        Streams:      16,
    }
    if err := speedtest.SaveResult(d, result); err != nil {
        t.Fatalf("SaveResult: %v", err)
    }

    var count int
    d.QueryRow(`SELECT COUNT(*) FROM speedtest_history`).Scan(&count)
    if count != 1 {
        t.Fatalf("expected 1 row, got %d", count)
    }
}
```

**Step 2: Run test to verify it fails**

```bash
go test -run TestSaveResult ./internal/speedtest/
```
Expected: FAIL (SaveResult not defined)

**Step 3: Add SaveResult function to speedtest package**

Add to `internal/speedtest/speedtest.go`:

```go
func SaveResult(db *sql.DB, r Result) error {
    _, err := db.Exec(
        `INSERT INTO speedtest_history (timestamp, download_mbps, upload_mbps, streams) VALUES (?, ?, ?, ?)`,
        r.Timestamp.UTC().Format(time.RFC3339), r.DownloadMbps, r.UploadMbps, r.Streams,
    )
    return err
}
```

Add `"database/sql"` to imports if not already present.

**Step 4: Run test to verify it passes**

```bash
go test -run TestSaveResult ./internal/speedtest/
```
Expected: PASS

**Step 5: Wire SaveResult into main.go**

In `cmd/server/main.go`, find where ISP test result is saved to config (search for `MeasuredDownloadMbps`). After the config update, add:

```go
if err := speedtest.SaveResult(database, result); err != nil {
    log.Printf("failed to save speedtest result: %v", err)
}
```

**Step 6: Commit**

```bash
git add internal/speedtest/speedtest.go internal/speedtest/history_test.go cmd/server/main.go
git commit -m "feat: persist ISP speed test results to speedtest_history table"
```

---

### Task 6: Add speedtest history API endpoint

**Files:**
- Modify: `internal/api/handlers.go`
- Modify: `internal/api/router.go`

**Step 1: Write the test**

Add to `internal/api/handlers_test.go` (or create if needed):

```go
func TestHandleSpeedtestHistory(t *testing.T) {
    d := db.OpenDB(":memory:")
    defer d.Close()

    // Insert test data
    d.Exec(`INSERT INTO speedtest_history (timestamp, download_mbps, upload_mbps, streams) VALUES (?, ?, ?, ?)`,
        "2026-04-01T12:00:00Z", 3452.5, 3100.0, 16)
    d.Exec(`INSERT INTO speedtest_history (timestamp, download_mbps, upload_mbps, streams) VALUES (?, ?, ?, ?)`,
        "2026-04-02T12:00:00Z", 3400.0, 3050.0, 16)

    app := &api.App{DB: d}
    req := httptest.NewRequest("GET", "/api/speedtest-history", nil)
    w := httptest.NewRecorder()
    app.HandleSpeedtestHistory(w, req)

    if w.Code != 200 {
        t.Fatalf("status=%d, want 200", w.Code)
    }
    var results []struct {
        DownloadMbps float64 `json:"downloadMbps"`
    }
    json.NewDecoder(w.Body).Decode(&results)
    if len(results) != 2 {
        t.Fatalf("got %d results, want 2", len(results))
    }
}
```

**Step 2: Run test to verify it fails**

```bash
go test -run TestHandleSpeedtestHistory ./internal/api/
```
Expected: FAIL

**Step 3: Implement the handler**

Add to `internal/api/handlers.go`:

```go
func (a *App) HandleSpeedtestHistory(w http.ResponseWriter, r *http.Request) {
    rows, err := a.DB.Query(
        `SELECT id, timestamp, download_mbps, upload_mbps, streams
         FROM speedtest_history ORDER BY timestamp DESC LIMIT 100`)
    if err != nil {
        writeError(w, 500, err.Error())
        return
    }
    defer rows.Close()

    type entry struct {
        ID           int     `json:"id"`
        Timestamp    string  `json:"timestamp"`
        DownloadMbps float64 `json:"downloadMbps"`
        UploadMbps   float64 `json:"uploadMbps"`
        Streams      int     `json:"streams"`
    }
    var results []entry
    for rows.Next() {
        var e entry
        if err := rows.Scan(&e.ID, &e.Timestamp, &e.DownloadMbps, &e.UploadMbps, &e.Streams); err != nil {
            writeError(w, 500, err.Error())
            return
        }
        results = append(results, e)
    }
    if results == nil {
        results = []entry{}
    }
    writeJSON(w, results)
}
```

Add to `internal/api/router.go`:

```go
mux.HandleFunc("GET /api/speedtest-history", app.HandleSpeedtestHistory)
```

**Step 4: Run test to verify it passes**

```bash
go test -run TestHandleSpeedtestHistory ./internal/api/
```
Expected: PASS

**Step 5: Commit**

```bash
git add internal/api/handlers.go internal/api/router.go internal/api/handlers_test.go
git commit -m "feat: add GET /api/speedtest-history endpoint"
```

---

### Task 7: Add daily usage aggregation API endpoint

**Files:**
- Modify: `internal/api/handlers.go`
- Modify: `internal/api/router.go`

**Step 1: Write the test**

```go
func TestHandleDailyUsage(t *testing.T) {
    d := db.OpenDB(":memory:")
    defer d.Close()

    // Insert throughput_history rows for 2 days
    d.Exec(`INSERT INTO throughput_history (timestamp, download_bytes, upload_bytes) VALUES (?, ?, ?)`,
        "2026-04-01T12:00:00Z", 1000000000, 500000000)
    d.Exec(`INSERT INTO throughput_history (timestamp, download_bytes, upload_bytes) VALUES (?, ?, ?)`,
        "2026-04-01T13:00:00Z", 2000000000, 1000000000)
    d.Exec(`INSERT INTO throughput_history (timestamp, download_bytes, upload_bytes) VALUES (?, ?, ?)`,
        "2026-04-02T12:00:00Z", 3000000000, 1500000000)

    app := &api.App{DB: d}
    req := httptest.NewRequest("GET", "/api/usage/daily?days=30", nil)
    w := httptest.NewRecorder()
    app.HandleDailyUsage(w, req)

    if w.Code != 200 {
        t.Fatalf("status=%d, want 200", w.Code)
    }
    var days []struct {
        Date          string `json:"date"`
        DownloadBytes int64  `json:"downloadBytes"`
    }
    json.NewDecoder(w.Body).Decode(&days)
    if len(days) != 2 {
        t.Fatalf("got %d days, want 2", len(days))
    }
}
```

**Step 2: Run test to verify it fails**

```bash
go test -run TestHandleDailyUsage ./internal/api/
```
Expected: FAIL

**Step 3: Implement**

Add to `internal/api/handlers.go`:

```go
func (a *App) HandleDailyUsage(w http.ResponseWriter, r *http.Request) {
    daysStr := r.URL.Query().Get("days")
    days := 30
    if daysStr != "" {
        if d, err := strconv.Atoi(daysStr); err == nil && d > 0 && d <= 90 {
            days = d
        }
    }

    cutoff := time.Now().UTC().AddDate(0, 0, -days).Format("2006-01-02")
    rows, err := a.DB.Query(
        `SELECT DATE(timestamp) as date,
                SUM(download_bytes) as download_bytes,
                SUM(upload_bytes) as upload_bytes
         FROM throughput_history
         WHERE DATE(timestamp) >= ?
         GROUP BY DATE(timestamp)
         ORDER BY date ASC`, cutoff)
    if err != nil {
        writeError(w, 500, err.Error())
        return
    }
    defer rows.Close()

    type dayEntry struct {
        Date          string `json:"date"`
        DownloadBytes int64  `json:"downloadBytes"`
        UploadBytes   int64  `json:"uploadBytes"`
    }
    var results []dayEntry
    for rows.Next() {
        var e dayEntry
        if err := rows.Scan(&e.Date, &e.DownloadBytes, &e.UploadBytes); err != nil {
            writeError(w, 500, err.Error())
            return
        }
        results = append(results, e)
    }
    if results == nil {
        results = []dayEntry{}
    }
    writeJSON(w, results)
}
```

Add to `internal/api/router.go`:

```go
mux.HandleFunc("GET /api/usage/daily", app.HandleDailyUsage)
```

**Step 4: Run test, verify pass**

```bash
go test -run TestHandleDailyUsage ./internal/api/
```
Expected: PASS

**Step 5: Commit**

```bash
git add internal/api/handlers.go internal/api/router.go internal/api/handlers_test.go
git commit -m "feat: add GET /api/usage/daily endpoint for daily aggregated usage"
```

---

### Task 8: Add peak speed tracking to stats collector

**Files:**
- Modify: `internal/stats/collector.go`

**Step 1: Write the test**

Add to `internal/stats/collector_test.go`:

```go
func TestPeakTracking(t *testing.T) {
    d := db.OpenDB(":memory:")
    defer d.Close()

    c := stats.NewCollector(d)
    c.ResetPeaks()

    c.AddDownloadBytes(125000000) // 1 Gbps for 1 second
    c.AddUploadBytes(250000000)   // 2 Gbps for 1 second

    // Wait for rate loop tick
    time.Sleep(1100 * time.Millisecond)

    peakDl, peakUl := c.PeakRates()
    if peakDl == 0 {
        t.Fatal("peak download should be > 0")
    }
    if peakUl == 0 {
        t.Fatal("peak upload should be > 0")
    }

    c.ResetPeaks()
    peakDl2, peakUl2 := c.PeakRates()
    if peakDl2 != 0 || peakUl2 != 0 {
        t.Fatal("peaks should be 0 after reset")
    }

    c.Stop()
}
```

**Step 2: Run test to verify it fails**

```bash
go test -run TestPeakTracking ./internal/stats/
```
Expected: FAIL (PeakRates/ResetPeaks not defined)

**Step 3: Add peak tracking to Collector**

In `internal/stats/collector.go`, add fields to the `Collector` struct:

```go
peakDownloadBps atomic.Int64
peakUploadBps   atomic.Int64
```

Add methods:

```go
func (c *Collector) PeakRates() (downloadBps, uploadBps int64) {
    return c.peakDownloadBps.Load(), c.peakUploadBps.Load()
}

func (c *Collector) ResetPeaks() {
    c.peakDownloadBps.Store(0)
    c.peakUploadBps.Store(0)
}
```

In the `rateLoop` function, after computing the rate snapshot, add peak tracking:

```go
if snap.DownloadBps > c.peakDownloadBps.Load() {
    c.peakDownloadBps.Store(snap.DownloadBps)
}
if snap.UploadBps > c.peakUploadBps.Load() {
    c.peakUploadBps.Store(snap.UploadBps)
}
```

**Step 4: Run test to verify it passes**

```bash
go test -run TestPeakTracking ./internal/stats/
```
Expected: PASS

**Step 5: Commit**

```bash
git add internal/stats/collector.go internal/stats/collector_test.go
git commit -m "feat: add peak speed tracking to stats collector"
```

---

### Task 9: Add peak speeds and next scheduled event to WebSocket and status API

**Files:**
- Modify: `internal/api/websocket.go` (WsMessage struct, lines 15-38)
- Modify: `internal/api/handlers.go` (HandleStatus, lines 267-310)
- Modify: `internal/scheduler/scheduler.go` (add NextEvent method)
- Modify: `cmd/server/main.go` (broadcast loop, lines 383-427)

**Step 1: Add NextEvent to scheduler**

In `internal/scheduler/scheduler.go`, add:

```go
type NextEvent struct {
    Action string    `json:"action"` // "start" or "stop"
    Time   time.Time `json:"time"`
    Name   string    `json:"name"` // schedule description
}

func (s *Scheduler) NextEvent() *NextEvent {
    if s.manualOverride.Load() != OverrideNone {
        return nil // manual override, no scheduled events
    }

    schedules, err := s.loadSchedules()
    if err != nil || len(schedules) == 0 {
        return nil
    }

    now := time.Now()
    _, inSchedule := s.findMatchingSchedule()

    // Look ahead 7 days for next event
    for offset := 0; offset < 7*24*60; offset++ {
        check := now.Add(time.Duration(offset) * time.Minute)
        for _, sched := range schedules {
            if !sched.Enabled {
                continue
            }
            dayMatch := false
            for _, d := range sched.DaysOfWeek {
                if int(check.Weekday()) == d {
                    dayMatch = true
                    break
                }
            }
            if !dayMatch {
                continue
            }
            startParts := strings.Split(sched.StartTime, ":")
            if len(startParts) != 2 {
                continue
            }
            sh, _ := strconv.Atoi(startParts[0])
            sm, _ := strconv.Atoi(startParts[1])
            startTime := time.Date(check.Year(), check.Month(), check.Day(), sh, sm, 0, 0, check.Location())

            endParts := strings.Split(sched.EndTime, ":")
            if len(endParts) != 2 {
                continue
            }
            eh, _ := strconv.Atoi(endParts[0])
            em, _ := strconv.Atoi(endParts[1])
            endTime := time.Date(check.Year(), check.Month(), check.Day(), eh, em, 0, 0, check.Location())
            if !endTime.After(startTime) {
                endTime = endTime.Add(24 * time.Hour)
            }

            if startTime.After(now) && (!inSchedule || startTime.Before(endTime)) {
                return &NextEvent{
                    Action: "start",
                    Time:   startTime,
                    Name:   fmt.Sprintf("%s %s-%s", sched.StartTime, sched.EndTime, strings.Join(dayNames(sched.DaysOfWeek), ",")),
                }
            }
            if endTime.After(now) && inSchedule {
                return &NextEvent{
                    Action: "stop",
                    Time:   endTime,
                    Name:   fmt.Sprintf("End %s", sched.EndTime),
                }
            }
        }
    }
    return nil
}
```

Note: This is a simplified version. The implementer should adapt it to work with the existing `findMatchingSchedule` and `loadSchedules` methods. The key API contract is: return `*NextEvent` with action, time, and name, or nil if no upcoming event.

**Step 2: Add fields to WsMessage**

In `internal/api/websocket.go`, add to `WsMessage`:

```go
PeakDownloadBps    int64  `json:"peakDownloadBps,omitempty"`
PeakUploadBps      int64  `json:"peakUploadBps,omitempty"`
NextScheduledEvent string `json:"nextScheduledEvent,omitempty"`
NextScheduledTime  string `json:"nextScheduledTime,omitempty"`
```

**Step 3: Add fields to status handler**

In `HandleStatus`, add to the response struct the same fields and populate them.

**Step 4: Wire into broadcast loop in main.go**

In the broadcast goroutine, add:

```go
peakDl, peakUl := collector.PeakRates()
// ... in the WsMessage literal:
PeakDownloadBps:    peakDl,
PeakUploadBps:      peakUl,
```

For next scheduled event, call `sched.NextEvent()` and populate the fields.

**Step 5: Add callback fields to App struct**

Add to `App` struct in handlers.go:

```go
GetPeakRates      func() (int64, int64)
GetNextEvent       func() interface{}
```

Wire these in main.go.

**Step 6: Run all tests**

```bash
go test -race ./...
```
Expected: All pass

**Step 7: Commit**

```bash
git add internal/api/websocket.go internal/api/handlers.go internal/scheduler/scheduler.go cmd/server/main.go
git commit -m "feat: add peak speeds and next scheduled event to WebSocket and status API"
```

---

### Task 10: Add frontend API client types for new endpoints

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/hooks/useWebSocket.ts`

**Step 1: Add types and methods to api/client.ts**

Add types:

```typescript
export interface SpeedTestHistoryEntry {
  id: number
  timestamp: string
  downloadMbps: number
  uploadMbps: number
  streams: number
}

export interface DailyUsageEntry {
  date: string
  downloadBytes: number
  uploadBytes: number
}
```

Add methods:

```typescript
async getSpeedtestHistory(): Promise<SpeedTestHistoryEntry[]> {
  return this.request('/api/speedtest-history')
}

async getDailyUsage(days: number = 30): Promise<DailyUsageEntry[]> {
  return this.request(`/api/usage/daily?days=${days}`)
}
```

**Step 2: Add peak and schedule fields to WsStats in useWebSocket.ts**

Add to the `WsStats` interface:

```typescript
peakDownloadBps: number
peakUploadBps: number
nextScheduledEvent: string
nextScheduledTime: string
```

**Step 3: Verify types compile**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors (new fields are optional via `omitempty` in Go so may be undefined)

**Step 4: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/hooks/useWebSocket.ts
git commit -m "feat: add frontend types for speedtest history, daily usage, peak speeds, next event"
```

---

## Phase 3: Navigation

### Task 11: Replace NavBar with icon-only tab bar

**Files:**
- Modify: `frontend/src/App.tsx` (NavBar section, lines 13-38)

**Step 1: Replace the NavBar**

Replace the NavBar section in App.tsx with an icon-only tab bar using lucide-react:

```tsx
import { Gauge, BarChart3, Clock, Settings, RefreshCw, Server } from 'lucide-react'

// NavBar component (replace existing)
function NavBar() {
  const navItems = [
    { to: '/', icon: Gauge, label: 'Dashboard' },
    { to: '/charts', icon: BarChart3, label: 'Charts' },
    { to: '/schedule', icon: Clock, label: 'Schedule' },
    { to: '/settings', icon: Settings, label: 'Settings' },
    { to: '/updates', icon: RefreshCw, label: 'Updates' },
    { to: '/servers', icon: Server, label: 'Servers' },
  ]

  return (
    <nav className="flex items-center gap-1 px-3 h-10 bg-forge-surface border-b border-forge-border">
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `relative p-2 rounded-md transition-colors group ${
              isActive
                ? 'text-amber-500'
                : 'text-zinc-500 hover:text-zinc-300'
            }`
          }
        >
          <Icon size={18} strokeWidth={2} />
          {/* Active indicator */}
          <NavLink
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              isActive ? 'absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-amber-500 rounded-full' : 'hidden'
            }
            tabIndex={-1}
            aria-hidden
          >
            <span />
          </NavLink>
          {/* Tooltip */}
          <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-0.5 text-xs font-medium text-zinc-300 bg-zinc-800 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
            {label}
          </span>
        </NavLink>
      ))}
    </nav>
  )
}
```

Note: The implementer should simplify the active indicator (don't use nested NavLink — use a `<span>` with conditional class). The above is conceptual. The key points:
- Icon-only, 40px height
- Amber (`text-amber-500`) for active, zinc-500 for inactive
- Tooltip on hover
- `bg-forge-surface` (zinc-900) background
- `border-forge-border` (zinc-800) bottom border

**Step 2: Update page background**

In App.tsx, change the main wrapper class from `bg-gray-950` to `bg-forge-base` and remove `max-w-7xl mx-auto` to allow full-width layouts (individual pages will constrain width as needed). Change `p-6` to `p-3`.

**Step 3: Remove "FloodTest Dashboard" etc page titles from Dashboard.tsx**

In `Dashboard.tsx` lines 31-51, remove the entire header row with the title and status indicators. Move the status indicators (server count, connected) into the control surface or hero card.

**Step 4: Verify build**

```bash
cd frontend && npm run build
```
Expected: Build succeeds

**Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/Dashboard.tsx
git commit -m "feat: replace NavBar with icon-only tab bar and remove page titles"
```

---

## Phase 4: Dashboard

### Task 12: Reskin Dashboard global styles

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx`

**Step 1: Replace all color classes**

Global find-and-replace in Dashboard.tsx:
- `bg-gray-950` → `bg-forge-base`
- `bg-gray-900` → `bg-forge-surface`
- `bg-gray-800` → `bg-forge-raised`
- `border-gray-800` → `border-forge-border`
- `border-gray-700` → `border-forge-border-strong`
- `text-gray-400` → `text-zinc-400`
- `text-gray-300` → `text-zinc-300`
- `text-gray-500` → `text-zinc-500`
- `text-white` → `text-zinc-50`
- `bg-blue-600` → `bg-amber-500`
- `bg-green-500` (status dots) → `bg-emerald-500`

Change usage stats card padding from `p-4` to `p-3`. Change grid gap from `gap-4` to `gap-2`.

All throughput numbers (formatBytes output) should get `font-mono` class.

**Step 2: Verify build**

```bash
cd frontend && npm run build
```

**Step 3: Commit**

```bash
git add frontend/src/components/Dashboard.tsx
git commit -m "refactor: apply Forge palette to Dashboard component"
```

---

### Task 13: Redesign Dashboard idle state (hero card)

**Files:**
- Modify: `frontend/src/components/ControlSurface.tsx` (idle state, lines 66-115)

**Step 1: Replace the idle state JSX**

The idle state currently shows: ModeToggle, description, ISP speed, Launch button in a centered card.

Replace with the hero card design:

```tsx
// Idle state
<div className="bg-forge-surface rounded-lg border border-forge-border p-4 shadow-lg shadow-amber-500/5">
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2">
      <Zap size={16} className="text-amber-500" />
      <span className="text-sm font-semibold text-zinc-50">READY</span>
    </div>
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500">{stats.healthyServers}/{stats.totalServers} healthy</span>
      <ModeToggle mode={mode} onChange={handleModeChange} compact />
    </div>
  </div>

  <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3 text-sm">
    <div>
      <span className="text-zinc-500">ISP Line</span>
      <span className="font-mono text-zinc-200 ml-2">
        ↓{formatSpeed(stats.measuredDownloadMbps * 1e6)} / ↑{formatSpeed(stats.measuredUploadMbps * 1e6)}
      </span>
    </div>
    <div>
      <span className="text-zinc-500">Tested</span>
      <span className="text-zinc-400 ml-2">{formatTimeAgo(config.lastSpeedTestTime)}</span>
    </div>
    {stats.nextScheduledTime && (
      <div className="col-span-2">
        <span className="text-zinc-500">Next</span>
        <span className="text-zinc-400 ml-2">{stats.nextScheduledEvent}</span>
      </div>
    )}
  </div>

  {/* ISP test progress (if running) */}
  {stats.ispTestRunning && (
    <div className="mb-3">
      <div className="h-1 bg-forge-raised rounded-full overflow-hidden">
        <div className="h-full bg-amber-500 transition-all" style={{ width: `${stats.ispTestProgress}%` }} />
      </div>
      <span className="text-xs text-zinc-500 mt-1">{stats.ispTestPhase}... {stats.ispTestProgress}%</span>
    </div>
  )}

  <button
    onClick={handleLaunch}
    className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-base transition-colors"
  >
    Launch
  </button>
</div>
```

Key design elements:
- `shadow-lg shadow-amber-500/5` — subtle amber glow
- Dense padding (`p-4`)
- Grid layout for ISP info
- Next scheduled event shown
- Launch button: red-600 (crimson), full width
- Geist Mono for all speed numbers

**Step 2: Hide TrafficFlow when not running**

In `Dashboard.tsx`, wrap TrafficFlow in:

```tsx
{ws.stats.running && <TrafficFlow stats={ws.stats} />}
```

**Step 3: Verify build**

```bash
cd frontend && npm run build
```

**Step 4: Commit**

```bash
git add frontend/src/components/ControlSurface.tsx frontend/src/components/Dashboard.tsx
git commit -m "feat: redesign idle Dashboard with compact hero card"
```

---

### Task 14: Add 24h sparkline to idle Dashboard

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx`

**Step 1: Add sparkline below usage stats when idle**

Add a mini Recharts area chart to the idle state:

```tsx
import { AreaChart, Area, ResponsiveContainer } from 'recharts'

// In the idle section, after usage stats grid:
{!ws.stats.running && recentHistory.length > 0 && (
  <div className="bg-forge-surface rounded-lg border border-forge-border p-3">
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Last 24h</span>
      <span className="text-xs font-mono text-zinc-500">
        avg ↓{formatSpeed(avgDownload)} · ↑{formatSpeed(avgUpload)}
      </span>
    </div>
    <ResponsiveContainer width="100%" height={48}>
      <AreaChart data={recentHistory}>
        <Area
          type="monotone"
          dataKey="downloadBps"
          stroke="#f59e0b"
          fill="#f59e0b"
          fillOpacity={0.15}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  </div>
)}
```

Fetch 24h history on mount via `api.getHistory('24h')` and store in state. Compute average from the data.

**Step 2: Verify build**

```bash
cd frontend && npm run build
```

**Step 3: Commit**

```bash
git add frontend/src/components/Dashboard.tsx
git commit -m "feat: add 24h sparkline to idle Dashboard"
```

---

### Task 15: Reskin ControlSurface running state

**Files:**
- Modify: `frontend/src/components/ControlSurface.tsx` (running state, lines 119-166)
- Modify: `frontend/src/components/ModeToggle.tsx`
- Modify: `frontend/src/components/ThroughputColumn.tsx`
- Modify: `frontend/src/components/ServerPoolColumn.tsx`
- Modify: `frontend/src/components/EngineLog.tsx`

**Step 1: Reskin ModeToggle**

Replace blue colors with amber:
- Active button: `bg-amber-500 text-zinc-950 shadow-sm` (dark text on amber)
- Inactive: `text-zinc-400 hover:text-zinc-200`
- Container: `bg-forge-raised p-0.5`

**Step 2: Reskin ThroughputColumn**

- Download speed: `text-orange-500 font-mono text-xl font-bold`
- Upload speed: `text-slate-400 font-mono text-xl font-bold`
- Add peak speed display: `text-xs text-zinc-500 font-mono` showing `peak {formatSpeed(peakBps)}`
- Progress bar: `bg-amber-500` fill on `bg-forge-raised` track (not green/yellow/red)
- Target text: `text-zinc-500 font-mono text-xs`
- Streams count: `text-zinc-500 text-xs font-mono`
- Labels: `text-zinc-500 uppercase tracking-wide text-xs`

**Step 3: Reskin ServerPoolColumn**

- Healthy dot: `bg-emerald-500`
- Unhealthy dot: `bg-amber-500`
- Text: `text-zinc-300 text-sm`
- Labels: `text-zinc-500 uppercase tracking-wide text-xs`

**Step 4: Reskin EngineLog**

- Event kind colors:
  - stream: `text-amber-400`
  - server: `text-orange-400`
  - adjust: `text-emerald-400`
  - test: `text-violet-400`
  - default: `text-zinc-400`
- Timestamp: `text-zinc-600 font-mono`
- Container: `scrollbar-thin` with forge scrollbar colors

**Step 5: Reskin running state header bar**

- Background: `bg-forge-surface border-b border-forge-border`
- Status dot: `bg-emerald-500` (pulsing via `animate-pulse`)
- Mode text: `text-zinc-300 text-sm`
- Uptime: `text-zinc-500 text-sm font-mono`
- Stop button: `bg-red-600/20 text-red-400 border border-red-800 hover:bg-red-600/30`

**Step 6: Verify build**

```bash
cd frontend && npm run build
```

**Step 7: Commit**

```bash
git add frontend/src/components/ControlSurface.tsx frontend/src/components/ModeToggle.tsx frontend/src/components/ThroughputColumn.tsx frontend/src/components/ServerPoolColumn.tsx frontend/src/components/EngineLog.tsx
git commit -m "feat: apply Forge palette to running state control surface"
```

---

### Task 16: Redesign TrafficFlow canvas colors

**Files:**
- Modify: `frontend/src/utils/trafficFlowRenderer.ts` (color constants at lines 120-130)

**Step 1: Replace the color palette**

Find the color constants (around line 120) and replace:

```typescript
// Old colors:
// downloadAccent: '#22d3ee'  (cyan)
// uploadAccent: '#a78bfa'    (violet)
// nodeBg: '#1e293b'          (slate-900)
// nodeBorder: '#374151'      (gray-700)

// New Forge colors:
downloadAccent: '#f59e0b',     // amber-500
downloadAccentAlt: '#ea580c',  // orange-600 (for gradient/particles)
uploadAccent: '#94a3b8',       // slate-400
uploadAccentAlt: '#64748b',    // slate-500
nodeBg: '#18181b',             // zinc-900 (forge-surface)
nodeBorder: '#27272a',         // zinc-800 (forge-border)
textPrimary: '#fafafa',        // zinc-50
textSecondary: '#a1a1aa',      // zinc-400
textDim: '#71717a',            // zinc-500
healthy: '#22c55e',            // green-500
warning: '#f59e0b',            // amber-500
```

**Step 2: Update center node gradient border**

Find the center node drawing code and change the gradient from cyan/violet to amber/orange:

```typescript
// Old: cyan-400 left → violet-400 right
// New: amber-500 left → orange-600 right
gradient.addColorStop(0, '#f59e0b')
gradient.addColorStop(1, '#ea580c')
```

**Step 3: Update pipe/particle colors**

Download pipes: use `#f59e0b` (amber) with particles in `#ea580c` (orange)
Upload pipes: use `#94a3b8` (slate-400) with particles in `#64748b` (slate-500)

**Step 4: Reduce line widths**

Find where pipe width is computed and scale down:
- Min width: 1px (was ~2px)
- Max width: 3px (was ~16px)
- Or reduce the multiplier by ~60%

**Step 5: Reduce vertical padding and node sizes**

Find node dimensions and reduce:
- Provider nodes: 130w x 44h (from 140x50)
- Center node: 190w x 170h (from 200x180)
- Gap between provider nodes: 6px (from 8px)

**Step 6: Update section labels**

Change "DOWNLOAD" and "UPLOAD" labels from gray to `text-zinc-600`

**Step 7: Update provider color array in providerGrouping.ts**

Replace the provider color palette with amber/warm tones:

```typescript
const PROVIDER_COLORS = [
  '#f59e0b', '#ea580c', '#f97316', '#d97706', '#c2410c',
  '#fbbf24', '#fb923c', '#facc15', '#ef4444', '#dc2626',
  '#a16207', '#92400e', '#b45309', '#78350f', '#ca8a04', '#eab308',
]
```

**Step 8: Verify build**

```bash
cd frontend && npm run build
```

**Step 9: Commit**

```bash
git add frontend/src/utils/trafficFlowRenderer.ts frontend/src/utils/providerGrouping.ts
git commit -m "feat: apply Forge palette to traffic flow diagram"
```

---

## Phase 5: Charts Page

### Task 17: Reskin Charts page with Forge palette

**Files:**
- Modify: `frontend/src/components/Charts.tsx`

**Step 1: Replace all color classes**

Global replacements in Charts.tsx:
- `bg-gray-900` → `bg-forge-surface`
- `bg-gray-800` → `bg-forge-raised`
- `border-gray-800` → `border-forge-border`
- `border-gray-700` → `border-forge-border-strong`
- `text-gray-400` → `text-zinc-400`
- `text-gray-300` → `text-zinc-300`
- Active range button: `bg-blue-600 text-white` → `bg-amber-500 text-zinc-950`
- Inactive range button: `bg-gray-800 text-gray-400` → `bg-forge-raised text-zinc-500 hover:text-zinc-300`

**Step 2: Replace chart line colors**

- Download line: `stroke="#f59e0b"` (was `#4ade80` green)
- Upload line: `stroke="#94a3b8"` (was `#60a5fa` blue)
- CartesianGrid: `stroke="#27272a"` (was `#374151`)
- XAxis/YAxis ticks: `fill="#71717a"` (was `#9ca3af`), `stroke="#27272a"` (was `#6b7280`)
- Throttle ReferenceArea: keep `fill="#ef4444"` `fillOpacity={0.1}`

**Step 3: Add gradient fills under lines**

Add `<defs>` with linear gradients inside the chart:

```tsx
<defs>
  <linearGradient id="downloadGradient" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
  </linearGradient>
  <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.2} />
    <stop offset="100%" stopColor="#94a3b8" stopOpacity={0} />
  </linearGradient>
</defs>
```

Change Line components to Area components (or add fill to Line):
- Download: `fill="url(#downloadGradient)"`
- Upload: `fill="url(#uploadGradient)"`

**Step 4: Reskin tooltip**

```tsx
<div className="bg-forge-surface border border-amber-500/30 rounded-lg p-2 shadow-lg">
  <p className="text-xs text-zinc-500 font-mono">{timestamp}</p>
  <p className="text-sm font-mono text-orange-400">↓ {formatSpeed(dlBps)}</p>
  <p className="text-sm font-mono text-slate-400">↑ {formatSpeed(ulBps)}</p>
</div>
```

**Step 5: Remove "Throughput History" title (nav tells you the page)**

**Step 6: Verify build**

```bash
cd frontend && npm run build
```

**Step 7: Commit**

```bash
git add frontend/src/components/Charts.tsx
git commit -m "feat: apply Forge palette to Charts page with gradient fills"
```

---

### Task 18: Add KPI summary cards to Charts page

**Files:**
- Modify: `frontend/src/components/Charts.tsx`

**Step 1: Add KPI cards above the chart**

Compute averages from the loaded history data:

```tsx
const avgDownload = history.reduce((s, p) => s + p.downloadBps, 0) / (history.length || 1)
const avgUpload = history.reduce((s, p) => s + p.uploadBps, 0) / (history.length || 1)
```

Add a 3-card row before the chart:

```tsx
<div className="grid grid-cols-3 gap-2 mb-2">
  <div className="bg-forge-surface rounded-lg border border-forge-border p-3">
    <span className="text-xs text-zinc-500 uppercase tracking-wide">Avg ↓ Speed</span>
    <p className="text-lg font-mono font-bold text-orange-400">{formatSpeed(avgDownload)}</p>
  </div>
  <div className="bg-forge-surface rounded-lg border border-forge-border p-3">
    <span className="text-xs text-zinc-500 uppercase tracking-wide">Avg ↑ Speed</span>
    <p className="text-lg font-mono font-bold text-slate-400">{formatSpeed(avgUpload)}</p>
  </div>
  <div className="bg-forge-surface rounded-lg border border-forge-border p-3">
    <span className="text-xs text-zinc-500 uppercase tracking-wide">Data Points</span>
    <p className="text-lg font-mono font-bold text-zinc-300">{history.length.toLocaleString()}</p>
  </div>
</div>
```

**Step 2: Verify build**

```bash
cd frontend && npm run build
```

**Step 3: Commit**

```bash
git add frontend/src/components/Charts.tsx
git commit -m "feat: add KPI summary cards to Charts page"
```

---

### Task 19: Add daily usage bar chart to Charts page

**Files:**
- Modify: `frontend/src/components/Charts.tsx`

**Step 1: Fetch daily usage data**

Add state and effect:

```tsx
const [dailyUsage, setDailyUsage] = useState<DailyUsageEntry[]>([])

useEffect(() => {
  api.getDailyUsage(30).then(setDailyUsage).catch(() => {})
}, [])
```

**Step 2: Add stacked bar chart below the main chart**

```tsx
import { BarChart, Bar } from 'recharts'

{dailyUsage.length > 0 && (
  <div className="bg-forge-surface rounded-lg border border-forge-border p-3 mt-2">
    <span className="text-xs text-zinc-500 uppercase tracking-wide mb-2 block">Daily Usage</span>
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={dailyUsage}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#71717a', fontSize: 10 }}
          stroke="#27272a"
          tickFormatter={(d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        />
        <YAxis
          tick={{ fill: '#71717a', fontSize: 10 }}
          stroke="#27272a"
          tickFormatter={(v) => formatBytes(v)}
        />
        <Tooltip content={<DailyUsageTooltip />} />
        <Bar dataKey="downloadBytes" fill="#f59e0b" radius={[2, 2, 0, 0]} name="Download" />
        <Bar dataKey="uploadBytes" fill="#94a3b8" radius={[2, 2, 0, 0]} name="Upload" />
      </BarChart>
    </ResponsiveContainer>
  </div>
)}
```

**Step 3: Verify build**

```bash
cd frontend && npm run build
```

**Step 4: Commit**

```bash
git add frontend/src/components/Charts.tsx
git commit -m "feat: add daily usage bar chart to Charts page"
```

---

### Task 20: Add ISP speedtest scatter plot to Charts page

**Files:**
- Modify: `frontend/src/components/Charts.tsx`

**Step 1: Fetch speedtest history**

```tsx
const [speedtestHistory, setSpeedtestHistory] = useState<SpeedTestHistoryEntry[]>([])

useEffect(() => {
  api.getSpeedtestHistory().then(setSpeedtestHistory).catch(() => {})
}, [])
```

**Step 2: Add scatter chart**

```tsx
import { ScatterChart, Scatter, ZAxis } from 'recharts'

{speedtestHistory.length > 0 && (
  <div className="bg-forge-surface rounded-lg border border-forge-border p-3 mt-2">
    <span className="text-xs text-zinc-500 uppercase tracking-wide mb-2 block">ISP Speed Tests</span>
    <ResponsiveContainer width="100%" height={160}>
      <ScatterChart>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey="timestamp"
          tick={{ fill: '#71717a', fontSize: 10 }}
          stroke="#27272a"
          tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        />
        <YAxis
          tick={{ fill: '#71717a', fontSize: 10 }}
          stroke="#27272a"
          unit=" Mbps"
        />
        <Tooltip content={<SpeedtestTooltip />} />
        <Scatter
          data={speedtestHistory.map(s => ({ ...s, value: s.downloadMbps }))}
          dataKey="value"
          fill="#f59e0b"
          name="Download"
        />
        <Scatter
          data={speedtestHistory.map(s => ({ ...s, value: s.uploadMbps }))}
          dataKey="value"
          fill="#94a3b8"
          name="Upload"
        />
      </ScatterChart>
    </ResponsiveContainer>
  </div>
)}
```

**Step 3: Verify build**

```bash
cd frontend && npm run build
```

**Step 4: Commit**

```bash
git add frontend/src/components/Charts.tsx
git commit -m "feat: add ISP speedtest scatter plot to Charts page"
```

---

### Task 21: Reskin ThrottleLog component

**Files:**
- Modify: `frontend/src/components/ThrottleLog.tsx`

**Step 1: Replace all colors**

- Table header: `text-zinc-500 text-xs uppercase tracking-wide`
- Row backgrounds: `bg-forge-surface` alternating with `bg-forge-base`
- Active event row: `border-l-2 border-l-red-600 bg-red-950/20`
- Resolved badge: `bg-zinc-800 text-zinc-400 text-xs rounded-full px-2 py-0.5`
- Active badge: `bg-red-600/20 text-red-400 text-xs rounded-full px-2 py-0.5` with pulsing dot
- Speed values: `font-mono text-sm`
- Timestamps: `font-mono text-zinc-500 text-xs`

**Step 2: Verify build**

```bash
cd frontend && npm run build
```

**Step 3: Commit**

```bash
git add frontend/src/components/ThrottleLog.tsx
git commit -m "feat: apply Forge palette to ThrottleLog"
```

---

## Phase 6: Other Pages

### Task 22: Reskin Schedule page

**Files:**
- Modify: `frontend/src/components/Schedule.tsx`

**Step 1: Add next scheduled event banner**

At the top of the page, show the next event (from WebSocket or a dedicated fetch):

```tsx
<div className="bg-forge-surface rounded-lg border border-amber-500/20 p-3 mb-2">
  <span className="text-xs text-zinc-500 uppercase tracking-wide">Next</span>
  <span className="font-mono text-sm text-amber-400 ml-2">{nextEvent}</span>
</div>
```

**Step 2: Replace all color classes**

- `bg-gray-900` → `bg-forge-surface`
- `bg-gray-800` → `bg-forge-raised`
- `border-gray-800` → `border-forge-border`
- `border-gray-700` → `border-forge-border-strong`
- Day buttons selected: `bg-blue-600 text-white` → `bg-amber-500 text-zinc-950`
- Day buttons unselected: `bg-gray-800 text-gray-400` → `bg-forge-raised text-zinc-500`
- Toggle on: `bg-blue-600` → `bg-amber-500`
- Toggle off: `bg-gray-700` → `bg-zinc-700`
- Inputs: replace `focus:ring-blue-500` → `focus:ring-amber-500`
- Schedule card active: add left border `border-l-2 border-l-emerald-500`
- Schedule card disabled: add left border `border-l-2 border-l-zinc-700`
- `p-6` → `p-3` or `p-4`

**Step 3: Verify build**

```bash
cd frontend && npm run build
```

**Step 4: Commit**

```bash
git add frontend/src/components/Schedule.tsx
git commit -m "feat: apply Forge palette to Schedule page with next event banner"
```

---

### Task 23: Reskin Settings page

**Files:**
- Modify: `frontend/src/components/Settings.tsx`

**Step 1: Replace all color classes**

- All `bg-gray-900` → `bg-forge-surface`
- All `bg-gray-800` → `bg-forge-raised` (inputs)
- All `border-gray-800` → `border-forge-border`
- All `border-gray-700` → `border-forge-border-strong`
- All `focus:ring-blue-500` → `focus:ring-amber-500`
- All `bg-blue-600` (buttons) → `bg-amber-500 text-zinc-950`
- All `hover:bg-blue-700` → `hover:bg-amber-600`
- Test Connection button: `border border-amber-500/50 text-amber-400 hover:bg-amber-500/10`
- Section dividers: `border-forge-border`
- `p-6` → `p-4`
- Speed inputs: add `font-mono` class
- Credential inputs: keep password type, add `font-mono`

**Step 2: Verify build**

```bash
cd frontend && npm run build
```

**Step 3: Commit**

```bash
git add frontend/src/components/Settings.tsx
git commit -m "feat: apply Forge palette to Settings page"
```

---

### Task 24: Reskin Updates page

**Files:**
- Modify: `frontend/src/components/Updates.tsx`

**Step 1: Replace all color classes**

- `bg-gray-900` → `bg-forge-surface`
- `bg-gray-800` → `bg-forge-raised`
- `border-gray-800` → `border-forge-border`
- `bg-blue-600` (buttons) → `bg-amber-500 text-zinc-950`
- `bg-green-600` (update button) → `bg-emerald-600 text-white`
- `bg-yellow-900/30 border-yellow-700` (Docker warning) → `bg-amber-950/30 border-amber-800`
- `text-yellow-400` → `text-amber-400`
- Toggle on: `bg-blue-600` → `bg-amber-500`
- Toggle off: `bg-gray-700` → `bg-zinc-700`
- Status badge success: `bg-emerald-900/50 text-emerald-400`
- Status badge failed: `bg-red-900/50 text-red-400`

**Step 2: Truncate SHA256 hashes**

In the update history table, truncate digest strings to first 8 characters:

```tsx
{entry.previousDigest?.slice(7, 15) || '—'}
```

(SHA256 hashes start with "sha256:", so slice from position 7 to get the first 8 hex chars)

Add a `title` attribute with the full hash for tooltip on hover.

**Step 3: Tighten padding**

- Card padding: `p-4` (was `p-6`)
- Table row padding: `py-2` (was `py-4`)
- Version card: compact grid with `gap-3`

**Step 4: Add amber accent border to version card**

```tsx
<div className="bg-forge-surface rounded-lg border border-forge-border border-t-2 border-t-amber-500 p-4">
```

**Step 5: Verify build**

```bash
cd frontend && npm run build
```

**Step 6: Commit**

```bash
git add frontend/src/components/Updates.tsx
git commit -m "feat: apply Forge palette to Updates page with truncated hashes"
```

---

### Task 25: Reskin ServerHealth page

**Files:**
- Modify: `frontend/src/components/ServerHealth.tsx`
- Modify: `frontend/src/components/ProviderAccordion.tsx`

**Step 1: Replace ServerHealth colors**

- `bg-gray-900` → `bg-forge-surface`
- `border-gray-800` → `border-forge-border`
- `text-cyan-400` (download header) → `text-orange-400`
- `text-violet-400` (upload header) → `text-slate-400`
- `bg-blue-600` (speed test button) → `bg-amber-500 text-zinc-950`
- `bg-blue-500` (progress bar) → `bg-amber-500`
- Status counts: use `text-emerald-400`, `text-amber-400`, `text-red-400`
- Unblock button: `bg-red-600/20 text-red-400 border border-red-800`

**Step 2: Add provider throughput summary bars**

Before the accordion sections, add a summary:

```tsx
<div className="bg-forge-surface rounded-lg border border-forge-border p-3 mb-2">
  <span className="text-xs text-zinc-500 uppercase tracking-wide mb-2 block">Provider Breakdown</span>
  {providerGroups.map(g => (
    <div key={g.name} className="flex items-center gap-2 mb-1">
      <span className="text-xs text-zinc-300 w-24 truncate">{g.name}</span>
      <div className="flex-1 h-2 bg-forge-raised rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full"
          style={{ width: `${(g.totalSpeedBps / maxProviderSpeed) * 100}%` }}
        />
      </div>
      <span className="text-xs font-mono text-zinc-400 w-20 text-right">
        {formatSpeed(g.totalSpeedBps)}
      </span>
    </div>
  ))}
</div>
```

**Step 3: Reskin ProviderAccordion**

- Provider header background: `bg-forge-surface hover:bg-forge-raised`
- Provider dot colors: replace the 10-color palette with amber/warm tones
- Status badge colors:
  - healthy: `bg-emerald-900/50 text-emerald-400 border-emerald-800`
  - testing: `bg-amber-900/50 text-amber-400 border-amber-800`
  - cooldown: `bg-amber-900/50 text-amber-400 border-amber-800`
  - failed: `bg-red-900/50 text-red-400 border-red-800`
  - blocked: `bg-red-900/50 text-red-400 border-red-800`
- Row backgrounds: `bg-forge-base` / `bg-forge-surface` alternating
- Speed values: `font-mono`
- Transferred values: `font-mono`

**Step 4: Verify build**

```bash
cd frontend && npm run build
```

**Step 5: Commit**

```bash
git add frontend/src/components/ServerHealth.tsx frontend/src/components/ProviderAccordion.tsx
git commit -m "feat: apply Forge palette to ServerHealth with provider summary bars"
```

---

### Task 26: Reskin SetupWizard

**Files:**
- Modify: `frontend/src/components/SetupWizard.tsx`

**Step 1: Replace all color classes**

- Background: `bg-forge-base`
- Cards: `bg-forge-surface border border-forge-border`
- Blue icon/text accents → amber:
  - `text-blue-400` → `text-amber-400`
  - `text-blue-500` → `text-amber-500`
- Wave SVG fill: `#f59e0b` (amber) instead of blue
- "Get Started" button: `bg-amber-500 text-zinc-950 hover:bg-amber-600`
- "Launch FloodTest" button: `bg-red-600 text-white hover:bg-red-500`
- Input fields: same forge input styling as other pages
- Step indicator: amber for current/completed, zinc for future
- Speed preset buttons: `bg-amber-500 text-zinc-950` when selected
- Progress dots: `bg-amber-500` active, `bg-zinc-700` inactive
- All inputs: `focus:ring-amber-500`
- Summary card: `bg-forge-raised`

**Step 2: Verify build**

```bash
cd frontend && npm run build
```

**Step 3: Commit**

```bash
git add frontend/src/components/SetupWizard.tsx
git commit -m "feat: apply Forge palette to SetupWizard"
```

---

## Phase 7: Build, Test, GitHub Branding

### Task 27: Build and verify all frontend tests pass

**Files:** None (test run only)

**Step 1: Run type check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors

**Step 2: Run frontend tests**

```bash
cd frontend && npx vitest run
```
Expected: All 12 tests pass

**Step 3: Fix any test failures**

Tests may reference specific colors or text content. Update assertions to match new Forge palette.

**Step 4: Build production frontend**

```bash
cd frontend && npm run build
```
Expected: Build succeeds

**Step 5: Commit any test fixes**

```bash
git add -A frontend/src/__tests__/
git commit -m "fix: update frontend tests for Forge palette"
```

---

### Task 28: Run all backend tests

**Files:** None (test run only)

**Step 1: Run Go tests**

```bash
go test -race ./...
```
Expected: All tests pass (including new speedtest_history and daily usage tests)

**Step 2: Fix any failures**

The new migration, SaveResult, handler, and peak tracking tests should all pass. Fix any issues.

**Step 3: Commit fixes if needed**

```bash
git add -A internal/
git commit -m "fix: resolve test failures from backend additions"
```

---

### Task 29: Rebuild embedded frontend and verify E2E

**Files:**
- Modify: `cmd/server/frontend/dist/` (rebuilt)

**Step 1: Copy built frontend**

```bash
cp -r frontend/dist cmd/server/frontend/dist
```

**Step 2: Build Go binary**

```bash
go build -o wansaturator ./cmd/server
```
Expected: Build succeeds

**Step 3: Run E2E tests**

```bash
cd e2e && npx playwright test
```
Expected: Tests pass. If E2E tests check specific text/colors, update selectors.

**Step 4: Commit embedded frontend**

```bash
git add cmd/server/frontend/dist/
git commit -m "chore: rebuild embedded frontend with Forge theme"
```

---

### Task 30: Update GitHub README hero SVG

**Files:**
- Modify: `README.md`

**Step 1: Replace blue gradients with amber/orange in hero SVG**

Find the animated SVG in README.md. Replace color values:
- Blue gradient stops (`#3b82f6`, `#2563eb`, `#1d4ed8`, etc.) → amber gradient (`#f59e0b`, `#d97706`, `#ea580c`)
- Blue text fills → amber fills
- Any blue icon colors → amber

**Step 2: Update shields.io badge colors**

If there are custom-colored badges, change `?color=3b82f6` to `?color=f59e0b`

**Step 3: Update architecture diagram colors**

If the architecture diagram uses blue accents, switch to amber

**Step 4: Verify README renders correctly**

Open in a markdown preview to check the SVG and colors look right.

**Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README branding to Forge amber/orange theme"
```

---

### Task 31: Final verification and cleanup

**Step 1: Run full test suite**

```bash
go test -race ./...
cd frontend && npx vitest run
cd e2e && npx playwright test
```
Expected: All tests pass

**Step 2: Visual check**

Start the app locally and verify each page:
- Dashboard idle: hero card, sparkline, usage stats, no flow diagram
- Dashboard running: amber/orange flow lines, restyled control surface
- Charts: amber/orange download, slate upload, KPI cards, daily bars, ISP scatter
- Schedule: next event banner, amber toggles
- Settings: amber inputs, forge surfaces
- Updates: truncated hashes, amber accents
- Server Health: provider bars, restyled accordion

**Step 3: Check no blue remnants**

```bash
cd frontend && grep -r "blue-" src/ --include="*.tsx" --include="*.ts" -l
```
Expected: No files (all blue should be replaced)

```bash
cd frontend && grep -r "gray-" src/ --include="*.tsx" --include="*.ts" -l
```
Expected: No files (all gray should be replaced with zinc or forge tokens)

**Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final Forge theme cleanup"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1: Foundation | 1-3 | npm deps, Geist fonts, Tailwind Forge theme |
| 2: Backend | 4-10 | speedtest_history table, daily usage API, peak tracking, next event, frontend types |
| 3: Navigation | 11 | Icon-only tab bar |
| 4: Dashboard | 12-16 | Reskin, idle hero card, sparkline, running state, traffic flow |
| 5: Charts | 17-21 | Reskin, KPI cards, daily usage bars, ISP scatter, throttle log |
| 6: Other Pages | 22-26 | Schedule, Settings, Updates, ServerHealth, SetupWizard |
| 7: Verify & Brand | 27-31 | Tests, E2E, embedded build, GitHub README |
