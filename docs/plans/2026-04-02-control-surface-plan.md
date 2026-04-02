# Control Surface Dashboard & Server Accordion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the dual-card mode selector with a single morphing Control Surface panel, add a real-time engine event log, and group the server health tables by provider.

**Architecture:** New `internal/events` package provides a thread-safe ring buffer. Download/upload engines emit structured events on auto-adjust and health changes. Events ride the existing WebSocket broadcast. Frontend replaces Dashboard mode cards with a ControlSurface component that transitions between idle (toggle + launch) and running (three-column command grid) states. ServerHealth page uses provider-grouped accordion via existing `providerGrouping.ts`.

**Tech Stack:** Go 1.22, React 18, TypeScript, Tailwind CSS, Vitest, `go test -race`

**Design doc:** `docs/plans/2026-04-02-control-surface-design.md`

---

## Task 1: Create `internal/events` Package

**Files:**
- Create: `internal/events/events.go`
- Create: `internal/events/events_test.go`

**Step 1: Write the test**

```go
// internal/events/events_test.go
package events

import (
	"testing"
	"time"
)

func TestBufferAddAndDrain(t *testing.T) {
	buf := NewBuffer(5)

	buf.Add("stream", "added 2 download streams")
	buf.Add("server", "hz-de3 entered cooldown")
	buf.Add("adjust", "auto-adjust: 87%")

	events := buf.Drain()
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(events))
	}
	if events[0].Kind != "stream" {
		t.Errorf("expected kind 'stream', got %q", events[0].Kind)
	}
	if events[0].Message != "added 2 download streams" {
		t.Errorf("unexpected message: %q", events[0].Message)
	}

	// Drain again should be empty
	events = buf.Drain()
	if len(events) != 0 {
		t.Fatalf("expected 0 events after drain, got %d", len(events))
	}
}

func TestBufferOverflow(t *testing.T) {
	buf := NewBuffer(3)

	buf.Add("a", "first")
	buf.Add("b", "second")
	buf.Add("c", "third")
	buf.Add("d", "fourth") // pushes out "first"

	events := buf.Drain()
	if len(events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(events))
	}
	if events[0].Message != "second" {
		t.Errorf("expected oldest to be 'second', got %q", events[0].Message)
	}
	if events[2].Message != "fourth" {
		t.Errorf("expected newest to be 'fourth', got %q", events[2].Message)
	}
}

func TestBufferTimestamp(t *testing.T) {
	buf := NewBuffer(10)
	before := time.Now()
	buf.Add("test", "hello")
	after := time.Now()

	events := buf.Drain()
	if events[0].Time.Before(before) || events[0].Time.After(after) {
		t.Errorf("timestamp %v not between %v and %v", events[0].Time, before, after)
	}
}

func TestBufferConcurrent(t *testing.T) {
	buf := NewBuffer(50)
	done := make(chan struct{})

	// Writer goroutine
	go func() {
		for i := 0; i < 100; i++ {
			buf.Add("test", "msg")
		}
		close(done)
	}()

	// Reader goroutine
	for i := 0; i < 10; i++ {
		_ = buf.Drain()
	}
	<-done
}
```

**Step 2: Run test to verify it fails**

Run: `go test -race ./internal/events/`
Expected: FAIL — package does not exist

**Step 3: Write implementation**

```go
// internal/events/events.go
package events

import (
	"sync"
	"time"
)

// Event represents a single engine decision or state change.
type Event struct {
	Time    time.Time `json:"time"`
	Kind    string    `json:"kind"`    // "stream", "server", "adjust", "test"
	Message string    `json:"message"`
}

// Buffer is a thread-safe ring buffer of engine events.
// New events push old ones out when capacity is reached.
type Buffer struct {
	mu     sync.Mutex
	events []Event
	cap    int
}

// NewBuffer creates an event buffer with the given capacity.
func NewBuffer(capacity int) *Buffer {
	return &Buffer{
		events: make([]Event, 0, capacity),
		cap:    capacity,
	}
}

// Add appends an event to the buffer. If at capacity, the oldest event is dropped.
func (b *Buffer) Add(kind, message string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	e := Event{
		Time:    time.Now(),
		Kind:    kind,
		Message: message,
	}

	if len(b.events) >= b.cap {
		// Shift left by one, append new
		copy(b.events, b.events[1:])
		b.events[len(b.events)-1] = e
	} else {
		b.events = append(b.events, e)
	}
}

// Drain returns all buffered events and clears the buffer.
// Events are returned in chronological order (oldest first).
func (b *Buffer) Drain() []Event {
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(b.events) == 0 {
		return nil
	}

	out := make([]Event, len(b.events))
	copy(out, b.events)
	b.events = b.events[:0]
	return out
}
```

**Step 4: Run test to verify it passes**

Run: `go test -race ./internal/events/`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add internal/events/
git commit -m "feat: add events ring buffer package for engine decisions"
```

---

## Task 2: Wire Events Into Download Engine

**Files:**
- Modify: `internal/download/engine.go` (lines 29-44, 320-369)

**Step 1: Add event emitter field to Engine struct**

In `internal/download/engine.go`, add an `eventBuf` field to the `Engine` struct (after line 43) and a setter method:

```go
// Add to Engine struct (after statsProvider field, line 42):
eventBuf interface{ Add(kind, message string) } // optional event buffer

// Add setter method after SetStatsProvider:
func (e *Engine) SetEventBuffer(buf interface{ Add(kind, message string) }) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.eventBuf = buf
}
```

**Step 2: Emit events in autoAdjust**

In `autoAdjust()` (line 320-369), after the existing `log.Printf` on line 364, add event emission:

```go
// After log.Printf on line 364-365, add:
if eb := e.eventBuf; eb != nil {
	eb.Add("stream", fmt.Sprintf("+%d download stream(s) → %d total", toAdd, e.activeStreams.Load()))
}
```

Also emit when at max capacity — add an else branch after the `if current < target*80/100` block (after line 366):

```go
} else if current >= target*80/100 {
	// Optionally emit efficiency events periodically (not every tick)
}
```

**Step 3: Run all Go tests**

Run: `go test -race ./internal/download/...`
Expected: PASS (existing tests still pass)

**Step 4: Commit**

```bash
git add internal/download/engine.go
git commit -m "feat: emit events from download engine auto-adjust"
```

---

## Task 3: Wire Events Into Download Server Health Changes

**Files:**
- Modify: `internal/download/servers.go` (lines 292-324, 326-340)

**Step 1: Add event emitter field to ServerList**

Add `eventBuf` field to the `ServerList` struct and a setter:

```go
// Add to ServerList struct:
eventBuf interface{ Add(kind, message string) }

// Add setter:
func (sl *ServerList) SetEventBuffer(buf interface{ Add(kind, message string) }) {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	sl.eventBuf = buf
}
```

**Step 2: Emit events in MarkUnhealthy**

In `MarkUnhealthy()` (line 292-324), after setting `s.unhealthyUntil` on line 320, emit:

```go
if sl.eventBuf != nil {
	loc := s.Location
	if loc == "" {
		loc = url
	}
	if s.blocked {
		sl.eventBuf.Add("server", fmt.Sprintf("%s blocked (%d failures)", loc, s.consecutiveFailures))
	} else {
		sl.eventBuf.Add("server", fmt.Sprintf("%s → cooldown (%d failures)", loc, s.consecutiveFailures))
	}
}
```

**Step 3: Emit events in MarkSuccess for recovery**

In `MarkSuccess()` (line 326+), when `consecutiveFailures` was > 0 and is reset, emit a recovery event:

```go
// After resetting consecutiveFailures:
wasDown := s.consecutiveFailures > 0
s.consecutiveFailures = 0
// ... existing logic ...
if wasDown && sl.eventBuf != nil {
	loc := s.Location
	if loc == "" {
		loc = url
	}
	sl.eventBuf.Add("server", fmt.Sprintf("%s recovered", loc))
}
```

**Step 4: Run tests**

Run: `go test -race ./internal/download/...`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/download/servers.go
git commit -m "feat: emit events on download server health changes"
```

---

## Task 4: Wire Events Into Upload Engines

**Files:**
- Modify: `internal/upload/engine.go` (lines 28-49, 328-362)
- Modify: `internal/upload/http_engine.go` (lines 21-36, 304-337)
- Modify: `internal/upload/upload_servers.go` (lines 54-60, 156-186, 188-210)

**Step 1: Add event emitter to S3 upload engine**

In `internal/upload/engine.go`, add `eventBuf` field and setter to `Engine` struct (same pattern as download):

```go
eventBuf interface{ Add(kind, message string) }

func (e *Engine) SetEventBuffer(buf interface{ Add(kind, message string) }) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.eventBuf = buf
}
```

In `autoAdjust()` (line 328-362), after the log.Printf on line 357-358:

```go
if eb := e.eventBuf; eb != nil {
	eb.Add("stream", fmt.Sprintf("+1 upload stream → %d total", e.activeStreams.Load()))
}
```

**Step 2: Add event emitter to HTTP upload engine**

Same pattern in `internal/upload/http_engine.go` — add `eventBuf` field to `HTTPEngine` struct and setter. In `autoAdjust()` (line 304-337), after the log.Printf on line 332-333:

```go
if eb := e.eventBuf; eb != nil {
	eb.Add("stream", fmt.Sprintf("+1 upload(http) stream → %d total", e.activeStreams.Load()))
}
```

**Step 3: Add event emitter to upload server list**

In `internal/upload/upload_servers.go`, add `eventBuf` field and setter to `UploadServerList`. Emit in `MarkUnhealthy()` (line 156-186) and `MarkSuccess()` (line 188+), same pattern as download servers.

**Step 4: Run tests**

Run: `go test -race ./internal/upload/...`
Expected: PASS

**Step 5: Commit**

```bash
git add internal/upload/
git commit -m "feat: emit events from upload engines and server health"
```

---

## Task 5: Add Events to WebSocket Broadcast

**Files:**
- Modify: `internal/api/websocket.go` (lines 14-36)
- Modify: `cmd/server/main.go` (lines 1-27, 365-408)

**Step 1: Add Events field to WsMessage**

In `internal/api/websocket.go`, add to `WsMessage` struct after line 35:

```go
Events []events.Event `json:"events,omitempty"`
```

Add import for `wansaturator/internal/events` at the top.

**Step 2: Create event buffer in main.go and wire it**

In `cmd/server/main.go`:

Add import: `"wansaturator/internal/events"`

After the collector initialization (around line 54), create the shared buffer:

```go
eventBuf := events.NewBuffer(50)
```

After engine creation (around lines 56-60), wire the buffer:

```go
serverList.SetEventBuffer(eventBuf)
dlEngine.SetEventBuffer(eventBuf)
// After upload engine creation (around lines 62-80):
uploadServerList.SetEventBuffer(eventBuf)
// Wire to whichever upload engine is active in startEngines
```

**Step 3: Drain events in broadcast loop**

In the WebSocket broadcast goroutine (lines 365-408), after building the `WsMessage` struct, add:

```go
// Before hub.Broadcast(msg):
msg.Events = eventBuf.Drain()
```

Add the `Events` field to the `hub.Broadcast(api.WsMessage{...})` call.

**Step 4: Run all Go tests**

Run: `go test -race ./...`
Expected: PASS (all 74+ tests)

**Step 5: Commit**

```bash
git add internal/api/websocket.go cmd/server/main.go
git commit -m "feat: broadcast engine events via WebSocket"
```

---

## Task 6: Frontend — Update Types and WebSocket Hook

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/hooks/useWebSocket.ts`

**Step 1: Add EngineEvent type to client.ts**

After the `UploadServerHealth` interface (line 120), add:

```typescript
export interface EngineEvent {
  time: string
  kind: string  // "stream" | "server" | "adjust" | "test"
  message: string
}
```

**Step 2: Update WsStats in useWebSocket.ts**

Add `events` field to the `WsStats` interface (after line 22):

```typescript
events?: EngineEvent[]
```

Add import: `import { EngineEvent } from '../api/client'`

Update the `EMPTY` constant to include `events: []`.

**Step 3: Accumulate events in the hook**

The hook currently replaces stats wholesale on each message. Events need to accumulate. Modify the `onmessage` handler (lines 62-67):

```typescript
ws.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data)
    setStats(prev => ({
      ...data,
      events: [...(prev.events || []), ...(data.events || [])].slice(-100),
    }))
  } catch {
    // ignore parse errors
  }
}
```

This accumulates events (up to 100 max) across WebSocket ticks.

**Step 4: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/hooks/useWebSocket.ts
git commit -m "feat: add EngineEvent type and event accumulation in WebSocket hook"
```

---

## Task 7: Frontend — ModeToggle Component

**Files:**
- Create: `frontend/src/components/ModeToggle.tsx`

**Step 1: Create the segmented toggle**

```typescript
// frontend/src/components/ModeToggle.tsx
interface ModeToggleProps {
  mode: string
  onChange: (mode: string) => void
  compact?: boolean
}

export default function ModeToggle({ mode, onChange, compact }: ModeToggleProps) {
  const modes = [
    { key: 'reliable', label: 'Reliable' },
    { key: 'max', label: 'Max' },
  ]

  return (
    <div className={`inline-flex rounded-lg bg-gray-800 p-0.5 ${compact ? 'text-xs' : 'text-sm'}`}>
      {modes.map(m => (
        <button
          key={m.key}
          onClick={() => onChange(m.key)}
          className={`rounded-md font-medium transition-colors ${
            compact ? 'px-3 py-1' : 'px-5 py-2'
          } ${
            mode === m.key
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/ModeToggle.tsx
git commit -m "feat: add ModeToggle segmented pill component"
```

---

## Task 8: Frontend — ThroughputColumn Component

**Files:**
- Create: `frontend/src/components/ThroughputColumn.tsx`

**Step 1: Create the component**

```typescript
// frontend/src/components/ThroughputColumn.tsx
import { WsStats } from '../hooks/useWebSocket'

interface ThroughputColumnProps {
  stats: WsStats
  mode: string
}

function formatSpeed(bps: number): string {
  const gbps = bps / 1_000_000_000
  if (gbps >= 1) return `${gbps.toFixed(2)} Gbps`
  return `${(bps / 1_000_000).toFixed(0)} Mbps`
}

export default function ThroughputColumn({ stats, mode }: ThroughputColumnProps) {
  const targetBps = stats.measuredDownloadMbps * 1_000_000 * 0.9
  const efficiency = targetBps > 0 ? Math.min(100, Math.round((stats.downloadBps / targetBps) * 100)) : 0

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Throughput</h3>

      <div className="space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-gray-500 text-xs">↓</span>
          <span className="text-xl font-bold text-white tabular-nums">
            {formatSpeed(stats.downloadBps)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-gray-500 text-xs">↑</span>
          <span className="text-xl font-bold text-white tabular-nums">
            {formatSpeed(stats.uploadBps)}
          </span>
        </div>
      </div>

      {mode === 'reliable' && targetBps > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Target: {formatSpeed(targetBps)}</span>
            <span className="text-gray-400 font-medium">{efficiency}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                efficiency >= 80 ? 'bg-green-500' : efficiency >= 50 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, efficiency)}%` }}
            />
          </div>
        </div>
      )}

      {mode === 'max' && (
        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-red-900/30 text-red-400 border border-red-900/50">
          Unlimited
        </span>
      )}

      <div className="text-sm text-gray-400">
        {stats.downloadStreams} ↓ · {stats.uploadStreams} ↑ streams
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/ThroughputColumn.tsx
git commit -m "feat: add ThroughputColumn component with efficiency bar"
```

---

## Task 9: Frontend — ServerPoolColumn Component

**Files:**
- Create: `frontend/src/components/ServerPoolColumn.tsx`

**Step 1: Create the component**

Uses WebSocket stats for counts. Polls server health API for provider count (reuses existing pattern from TrafficFlow).

```typescript
// frontend/src/components/ServerPoolColumn.tsx
import { WsStats } from '../hooks/useWebSocket'

interface ServerPoolColumnProps {
  stats: WsStats
  providerCount: number
}

export default function ServerPoolColumn({ stats, providerCount }: ServerPoolColumnProps) {
  const healthy = stats.healthyServers
  const total = stats.totalServers
  const cooldown = total - healthy // approximate — blocked servers also subtract
  const blocked = 0 // We'd need per-state counts; for now show healthy vs rest

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Server Pool</h3>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm text-gray-300">{healthy} healthy</span>
        </div>
        {total - healthy > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-sm text-gray-300">{total - healthy} unhealthy</span>
          </div>
        )}
      </div>

      <div className="space-y-1 text-sm text-gray-400">
        <div>{providerCount} providers</div>
        <div>{stats.downloadStreams + stats.uploadStreams} active streams</div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/ServerPoolColumn.tsx
git commit -m "feat: add ServerPoolColumn component"
```

---

## Task 10: Frontend — EngineLog Component

**Files:**
- Create: `frontend/src/components/EngineLog.tsx`

**Step 1: Create the scrolling event feed**

```typescript
// frontend/src/components/EngineLog.tsx
import { useRef, useEffect, useState } from 'react'
import { EngineEvent } from '../api/client'

interface EngineLogProps {
  events: EngineEvent[]
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

const kindColor: Record<string, string> = {
  stream: 'text-blue-400',
  server: 'text-amber-400',
  adjust: 'text-green-400',
  test: 'text-purple-400',
}

export default function EngineLog({ events }: EngineLogProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [events.length, autoScroll])

  const handleScroll = () => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 30)
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Engine Log</h3>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-40 overflow-y-auto space-y-0.5 scrollbar-thin scrollbar-thumb-gray-700"
      >
        {events.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No events yet</p>
        ) : (
          events.slice().reverse().map((e, i) => (
            <div key={`${e.time}-${i}`} className="flex gap-2 text-xs font-mono">
              <span className="text-gray-600 flex-shrink-0">{formatTime(e.time)}</span>
              <span className={`${kindColor[e.kind] || 'text-gray-400'} truncate`}>
                {e.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/EngineLog.tsx
git commit -m "feat: add EngineLog scrolling event feed component"
```

---

## Task 11: Frontend — ControlSurface Component

**Files:**
- Create: `frontend/src/components/ControlSurface.tsx`

This is the main orchestrating component. It handles idle/running state transitions.

**Step 1: Create the component**

```typescript
// frontend/src/components/ControlSurface.tsx
import { useState, useEffect, useCallback } from 'react'
import { WsStats } from '../hooks/useWebSocket'
import { api, ServerHealth, UploadServerHealth } from '../api/client'
import { groupDownloadServers } from '../utils/providerGrouping'
import ModeToggle from './ModeToggle'
import ThroughputColumn from './ThroughputColumn'
import ServerPoolColumn from './ServerPoolColumn'
import EngineLog from './EngineLog'

interface ControlSurfaceProps {
  stats: WsStats
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function ControlSurface({ stats }: ControlSurfaceProps) {
  const [mode, setMode] = useState<string>('reliable')
  const [toggling, setToggling] = useState(false)
  const [providerCount, setProviderCount] = useState(0)

  // Sync mode from WebSocket
  useEffect(() => {
    if (stats.autoMode) setMode(stats.autoMode)
  }, [stats.autoMode])

  // Poll server health for provider count (reuses TrafficFlow pattern)
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const servers = await api.getServerHealth()
        const groups = groupDownloadServers(servers)
        setProviderCount(groups.length)
      } catch { /* ignore */ }
    }
    fetchProviders()
    const interval = setInterval(fetchProviders, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleModeChange = async (newMode: string) => {
    setMode(newMode)
    await api.updateSettings({ autoMode: newMode })
  }

  const handleToggle = async () => {
    setToggling(true)
    try {
      if (stats.running) {
        await api.stop()
      } else {
        await api.start()
      }
    } catch { /* ignore */ }
    finally { setToggling(false) }
  }

  const isRunning = stats.running
  const hasMeasurements = stats.measuredDownloadMbps > 0

  // --- IDLE STATE ---
  if (!isRunning) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 max-w-lg mx-auto text-center space-y-5 transition-all duration-300">
        <ModeToggle mode={mode} onChange={handleModeChange} />

        <div className="space-y-2">
          {mode === 'reliable' ? (
            <>
              <p className="text-sm text-gray-400">
                Auto-tuned for sustained throughput. Measures your line, targets 90% of capacity.
              </p>
              {hasMeasurements ? (
                <p className="text-xs text-gray-500">
                  Last measured: {Math.round(stats.measuredDownloadMbps)} / {Math.round(stats.measuredUploadMbps)} Mbps
                </p>
              ) : (
                <p className="text-xs text-gray-500">Will run speed test on start</p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400">
                No rate limits. Maximum parallel streams push your hardware to the edge.
              </p>
              <p className="text-xs text-gray-500">64 download · 32 upload streams</p>
            </>
          )}
        </div>

        {/* ISP Speed Test Progress */}
        {stats.ispTestRunning && (
          <div className="space-y-2">
            <p className="text-sm text-blue-400">{stats.ispTestPhase || 'Running speed test...'}</p>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${stats.ispTestProgress}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleToggle}
          disabled={toggling}
          className="px-8 py-3 rounded-lg font-semibold text-base bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
        >
          {toggling ? '...' : 'Launch'}
        </button>
      </div>
    )
  }

  // --- RUNNING STATE ---
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 transition-all duration-300">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-semibold text-white capitalize">{mode}</span>
          <span className="text-sm text-gray-500">·</span>
          <span className="text-sm text-gray-400 tabular-nums">{formatDuration(stats.uptimeSeconds)}</span>
        </div>
        <div className="flex items-center gap-3">
          <ModeToggle mode={mode} onChange={handleModeChange} compact />
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-red-600/20 text-red-400 border border-red-800 hover:bg-red-600/30 transition-colors disabled:opacity-50"
          >
            {toggling ? '...' : 'Stop'}
          </button>
        </div>
      </div>

      {/* ISP Speed Test Progress (shown in running state too, during initial test) */}
      {stats.ispTestRunning && (
        <div className="px-5 py-2 border-b border-gray-800 space-y-1">
          <p className="text-xs text-blue-400">{stats.ispTestPhase || 'Running speed test...'}</p>
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${stats.ispTestProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Three-column command grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 md:divide-x divide-gray-800">
        <div className="p-5">
          <ThroughputColumn stats={stats} mode={mode} />
        </div>
        <div className="p-5 border-t md:border-t-0 border-gray-800">
          <ServerPoolColumn stats={stats} providerCount={providerCount} />
        </div>
        <div className="p-5 border-t md:border-t-0 border-gray-800">
          <EngineLog events={stats.events || []} />
        </div>
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/ControlSurface.tsx
git commit -m "feat: add ControlSurface component with idle/running state morphing"
```

---

## Task 12: Frontend — Replace Dashboard Mode Cards with ControlSurface

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx` (full rewrite of mode section)

**Step 1: Simplify Dashboard.tsx**

Replace the current mode selector (lines 107-166), start/stop button (lines 167-271), and ISP speed test progress sections with a single `<ControlSurface stats={stats} />`. Keep the header row (lines 80-106), TrafficFlow, and usage stats sections.

The new Dashboard structure:

```typescript
import { useState, useEffect } from 'react'
import { WsStats } from '../hooks/useWebSocket'
import { api, UsageCounters } from '../api/client'
import TrafficFlow from '../components/TrafficFlow'
import ControlSurface from '../components/ControlSurface'

interface DashboardProps {
  ws: { stats: WsStats; connected: boolean }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${(bytes / 1e6).toFixed(2)} MB`
}

export default function Dashboard({ ws }: DashboardProps) {
  const { stats, connected } = ws
  const [usage, setUsage] = useState<UsageCounters | null>(null)

  useEffect(() => {
    const fetchUsage = () => { api.getUsage().then(setUsage).catch(() => {}) }
    fetchUsage()
    const interval = setInterval(fetchUsage, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">FloodTest Dashboard</h2>
        <div className="flex items-center gap-4">
          {stats.totalServers > 0 && (
            <div className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${
                stats.healthyServers === stats.totalServers ? 'bg-green-500'
                : stats.healthyServers < stats.totalServers * 0.5 ? 'bg-red-500'
                : 'bg-yellow-500'
              }`} />
              <span className="text-sm text-gray-400">
                {stats.healthyServers}/{stats.totalServers} servers
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-400">{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </div>

      {/* Control Surface — replaces mode cards, start/stop, and speed test progress */}
      <ControlSurface stats={stats} />

      {/* Traffic Flow */}
      <TrafficFlow stats={stats} />

      {/* Usage Stats — keep existing usage section from original Dashboard */}
      {usage && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Session', dl: usage.session.downloadBytes, ul: usage.session.uploadBytes },
            { label: 'Today', dl: usage.today.downloadBytes, ul: usage.today.uploadBytes },
            { label: 'This Month', dl: usage.month.downloadBytes, ul: usage.month.uploadBytes },
            { label: 'All Time', dl: usage.allTime.downloadBytes, ul: usage.allTime.uploadBytes },
          ].map(u => (
            <div key={u.label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{u.label}</h3>
              <div className="text-sm text-gray-300">↓ {formatBytes(u.dl)}</div>
              <div className="text-sm text-gray-300">↑ {formatBytes(u.ul)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 2: Remove the ServerHealth import from Dashboard**

The old Dashboard imported ServerHealth as a tab/section. The new version does not — ServerHealth stays as its own page.

**Step 3: Run frontend type check and tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx
git commit -m "feat: replace Dashboard mode cards with ControlSurface"
```

---

## Task 13: Frontend — ProviderAccordion and ProviderRow Components

**Files:**
- Create: `frontend/src/components/ProviderAccordion.tsx`

This component groups servers by provider and renders collapsible sections.

**Step 1: Create the component**

```typescript
// frontend/src/components/ProviderAccordion.tsx
import { useState, useMemo } from 'react'
import { ServerHealth, UploadServerHealth } from '../api/client'

// Re-use provider detection from providerGrouping.ts
const PROVIDER_PATTERNS: [RegExp, string][] = [
  [/hetzner\.(com|de)/, 'Hetzner'],
  [/vultr\.com/, 'Vultr'],
  [/leaseweb\.net/, 'Leaseweb'],
  [/ovh\.net/, 'OVH'],
  [/clouvider\.net/, 'Clouvider'],
  [/linode\.com/, 'Linode'],
  [/tele2\.net/, 'Tele2'],
  [/fdcservers\.net/, 'FDC'],
  [/belwue\.net/, 'BelWü'],
  [/online\.net/, 'Online.net'],
  [/serverius\.net/, 'Serverius'],
  [/worldstream\.nl/, 'Worldstream'],
  [/thinkbroadband\.com/, 'ThinkBroadband'],
  [/cloudflare\.com/, 'Cloudflare'],
  [/backblazeb2\.com/, 'Backblaze B2'],
  [/scaleway/, 'Scaleway'],
]

const PROVIDER_COLORS: Record<string, string> = {}
const COLOR_PALETTE = [
  'bg-cyan-500', 'bg-violet-500', 'bg-emerald-500', 'bg-pink-500', 'bg-orange-500',
  'bg-yellow-500', 'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-red-500',
]

function extractProvider(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    for (const [pattern, name] of PROVIDER_PATTERNS) {
      if (pattern.test(hostname)) return name
    }
    const parts = hostname.split('.')
    if (parts.length >= 2) return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1)
    return hostname
  } catch { return 'Unknown' }
}

function getProviderColor(name: string, index: number): string {
  if (!PROVIDER_COLORS[name]) {
    PROVIDER_COLORS[name] = COLOR_PALETTE[index % COLOR_PALETTE.length]
  }
  return PROVIDER_COLORS[name]
}

// Normalized server shape for rendering
interface NormalizedServer {
  url: string
  location: string
  status: string
  speedBps: number
  activeStreams: number
  bytesTransferred: number
  consecutiveFailures: number
  lastError?: string
  blocked: boolean
}

function normalizeDownload(s: ServerHealth): NormalizedServer {
  return {
    url: s.url, location: s.location, status: s.status,
    speedBps: s.speedBps, activeStreams: s.activeStreams,
    bytesTransferred: s.bytesDownloaded,
    consecutiveFailures: s.consecutiveFailures,
    lastError: s.lastError, blocked: s.blocked,
  }
}

function normalizeUpload(s: UploadServerHealth): NormalizedServer {
  return {
    url: s.url, location: s.location, status: s.status,
    speedBps: s.speedBps, activeStreams: s.activeStreams,
    bytesTransferred: s.bytesUploaded,
    consecutiveFailures: s.consecutiveFailures,
    lastError: s.lastError, blocked: s.blocked,
  }
}

interface ProviderGroup {
  name: string
  color: string
  servers: NormalizedServer[]
  totalSpeed: number
  healthyCount: number
  totalCount: number
}

function formatSpeed(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)} Mbps`
  if (bps > 0) return `${(bps / 1_000).toFixed(0)} Kbps`
  return '—'
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function formatUrl(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}

interface ProviderAccordionProps {
  downloadServers?: ServerHealth[]
  uploadServers?: UploadServerHealth[]
  onUnblock?: (url: string) => void
}

export default function ProviderAccordion({ downloadServers, uploadServers, onUnblock }: ProviderAccordionProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [allExpanded, setAllExpanded] = useState(false)

  const groups = useMemo(() => {
    const normalized = downloadServers
      ? downloadServers.map(normalizeDownload)
      : (uploadServers || []).map(normalizeUpload)

    const map = new Map<string, NormalizedServer[]>()
    for (const s of normalized) {
      const provider = extractProvider(s.url)
      const list = map.get(provider) || []
      list.push(s)
      map.set(provider, list)
    }

    const result: ProviderGroup[] = []
    let colorIdx = 0
    for (const [name, servers] of map) {
      const totalSpeed = servers.reduce((sum, s) => sum + s.speedBps, 0)
      const healthyCount = servers.filter(s => s.status === 'healthy' || s.status === 'testing').length
      servers.sort((a, b) => b.speedBps - a.speedBps)
      result.push({
        name,
        color: getProviderColor(name, colorIdx++),
        servers,
        totalSpeed,
        healthyCount,
        totalCount: servers.length,
      })
    }

    // Sort: unhealthy providers first, then by speed descending
    result.sort((a, b) => {
      const aUnhealthy = a.healthyCount < a.totalCount ? 1 : 0
      const bUnhealthy = b.healthyCount < b.totalCount ? 1 : 0
      if (aUnhealthy !== bUnhealthy) return bUnhealthy - aUnhealthy
      return b.totalSpeed - a.totalSpeed
    })

    return result
  }, [downloadServers, uploadServers])

  const toggleProvider = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const toggleAll = () => {
    if (allExpanded) {
      setExpanded(new Set())
    } else {
      setExpanded(new Set(groups.map(g => g.name)))
    }
    setAllExpanded(!allExpanded)
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-end mb-2">
        <button
          onClick={toggleAll}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {groups.map(group => {
        const isOpen = expanded.has(group.name)
        const healthColor = group.healthyCount === group.totalCount
          ? 'text-green-400'
          : group.healthyCount === 0 ? 'text-red-400' : 'text-amber-400'

        return (
          <div key={group.name} className="border border-gray-800 rounded-lg overflow-hidden">
            {/* Provider header */}
            <button
              onClick={() => toggleProvider(group.name)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900 hover:bg-gray-800/70 transition-colors text-left"
            >
              <span className="text-gray-500 text-xs w-4">{isOpen ? '▾' : '▸'}</span>
              <div className={`w-2.5 h-2.5 rounded-full ${group.color}`} />
              <span className="text-sm font-medium text-white flex-1">{group.name}</span>
              <span className="text-xs text-gray-400">{group.totalCount} servers</span>
              <span className="text-xs text-gray-400">·</span>
              <span className="text-xs text-gray-400">{formatSpeed(group.totalSpeed)}</span>
              <span className="text-xs text-gray-400">·</span>
              <span className={`text-xs font-medium ${healthColor}`}>
                {group.healthyCount}/{group.totalCount}
              </span>
            </button>

            {/* Expanded server table */}
            {isOpen && (
              <div className="border-t border-gray-800">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 uppercase tracking-wide">
                      <th className="text-left px-4 py-2 font-medium">Server</th>
                      <th className="text-left px-4 py-2 font-medium">Location</th>
                      <th className="text-right px-4 py-2 font-medium">Speed</th>
                      <th className="text-right px-4 py-2 font-medium">Streams</th>
                      <th className="text-right px-4 py-2 font-medium">Transferred</th>
                      <th className="text-center px-4 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.servers.map(s => (
                      <tr key={s.url} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-2 text-gray-300 font-mono">{formatUrl(s.url)}</td>
                        <td className="px-4 py-2 text-gray-400">{s.location || '—'}</td>
                        <td className="px-4 py-2 text-right text-gray-300 tabular-nums">{formatSpeed(s.speedBps)}</td>
                        <td className="px-4 py-2 text-right text-gray-300 tabular-nums">{s.activeStreams}</td>
                        <td className="px-4 py-2 text-right text-gray-300 tabular-nums">{formatBytes(s.bytesTransferred)}</td>
                        <td className="px-4 py-2 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              s.status === 'healthy' || s.status === 'testing' ? 'bg-green-500'
                              : s.status === 'cooldown' ? 'bg-amber-500'
                              : 'bg-red-500'
                            }`} />
                            <span className={`${
                              s.status === 'healthy' || s.status === 'testing' ? 'text-green-400'
                              : s.status === 'cooldown' ? 'text-amber-400'
                              : 'text-red-400'
                            }`}>{s.status}</span>
                            {s.blocked && onUnblock && (
                              <button
                                onClick={() => onUnblock(s.url)}
                                className="ml-1 text-blue-400 hover:text-blue-300 underline"
                              >
                                unblock
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add frontend/src/components/ProviderAccordion.tsx
git commit -m "feat: add ProviderAccordion component with grouped server tables"
```

---

## Task 14: Frontend — Update ServerHealth Page to Use ProviderAccordion

**Files:**
- Modify: `frontend/src/pages/ServerHealth.tsx`

**Step 1: Replace flat tables with ProviderAccordion**

The ServerHealth page currently has two collapsible sections (Download Servers, Upload Servers) each containing a flat `ServerTable`. Replace the `ServerTable` inside each section with `<ProviderAccordion>`.

Keep the section headers, speed test button, unblock-all button, and status counts. Replace only the table body.

For the Download Servers section, change:
```typescript
// Before:
<ServerTable servers={...} ... />

// After:
<ProviderAccordion
  downloadServers={downloadServers}
  onUnblock={(url) => handleUnblock(url)}
/>
```

For the Upload Servers section:
```typescript
<ProviderAccordion
  uploadServers={uploadServers}
  onUnblock={(url) => handleUnblockUpload(url)}
/>
```

Remove the old `ServerTable` component and its sorting logic (lines 210-379) since it's no longer used. Keep the section-level controls (Run Speed Test, Unblock All, status counts).

**Step 2: Run frontend type check and tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/pages/ServerHealth.tsx
git commit -m "feat: replace flat server tables with provider-grouped accordion"
```

---

## Task 15: Build, Embed, and Verify

**Files:**
- Modify: `cmd/server/frontend/dist/` (rebuilt)

**Step 1: Build frontend**

Run: `cd frontend && npm run build`
Expected: Build completes without errors

**Step 2: Copy to embed directory**

Run: `rm -rf cmd/server/frontend/dist && cp -r frontend/dist cmd/server/frontend/dist`

**Step 3: Run all Go tests**

Run: `go test -race ./...`
Expected: PASS (all tests)

**Step 4: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: PASS

**Step 5: Build Go binary**

Run: `go build -o wansaturator ./cmd/server`
Expected: Binary builds successfully

**Step 6: Commit**

```bash
git add cmd/server/frontend/dist/
git commit -m "chore: update embedded frontend with control surface and server accordion"
```

---

## Task Summary

| Task | Description | Est. |
|------|-------------|------|
| 1 | `internal/events` package + tests | 5 min |
| 2 | Wire events into download engine auto-adjust | 3 min |
| 3 | Wire events into download server health | 5 min |
| 4 | Wire events into upload engines + server health | 5 min |
| 5 | Add Events to WebSocket broadcast + main.go wiring | 5 min |
| 6 | Frontend types + WebSocket event accumulation | 3 min |
| 7 | ModeToggle component | 2 min |
| 8 | ThroughputColumn component | 3 min |
| 9 | ServerPoolColumn component | 2 min |
| 10 | EngineLog component | 3 min |
| 11 | ControlSurface component | 5 min |
| 12 | Replace Dashboard mode cards | 5 min |
| 13 | ProviderAccordion component | 5 min |
| 14 | Update ServerHealth with accordion | 5 min |
| 15 | Build, embed, verify | 3 min |
