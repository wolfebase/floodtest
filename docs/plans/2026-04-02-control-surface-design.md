# Control Surface Dashboard & Server Accordion — Design

**Date:** 2026-04-02
**Status:** Approved

## Overview

Replace the dual-card mode selector with a single dynamic "Control Surface" panel that transforms between idle and running states. Replace the flat server table on ServerHealth with a provider-grouped accordion.

## Goals

- One cohesive surface that morphs from mode selection into a live command center
- Sleek, minimal idle state — generous negative space, single toggle, one button
- Information-dense running state — throughput, server health, engine decisions in a three-column grid
- Server list scales to 90+ servers via provider grouping with collapsible sections
- No new pages or navigation — the dashboard adapts to context

## Non-Goals

- Custom speed configuration on the dashboard (stays in Settings)
- Replacing the TrafficFlow visualization (it remains below the Control Surface)
- Historical data or charts (that's the Charts page)

---

## 1. Control Surface — Idle State

A single centered panel above the TrafficFlow. Nothing else in this region.

**Elements:**
- **Segmented toggle** at the top: two segments in a pill shape. Selected segment is filled/bright, other is ghost/outline. Flipping is instant.
- **Dynamic description** below the toggle — crossfades when the toggle changes:
  - **Reliable:** "Auto-tuned for sustained throughput. Measures your line, targets 90% of capacity." If previous speed test: "Last measured: X / Y Gbps". If none: "Will run speed test on start."
  - **Max:** "No rate limits. Maximum parallel streams push your hardware to the edge." Shows "64 download · 32 upload streams" below.
- **Launch button** — single prominent button centered at the bottom of the panel.

**Styling:** `bg-gray-900` panel, subtle border, generous padding, centered on the page. Consistent with existing Tailwind dark theme.

Custom speed overrides live on the Settings page. The dashboard is for operating, not configuring.

---

## 2. Control Surface — Running State

When Launch is pressed, the surface morphs in place (same DOM element, ~300ms CSS transition).

### Header Bar

- **Left:** Glowing green dot (pulses subtly) + mode name + uptime timer
- **Right:** Compact segmented toggle (smaller, no descriptions, still functional — tapping the other mode switches live) + Stop button (red outline)

### Three-Column Command Grid

**Left — Throughput:**
- Large download and upload speed readouts as separate lines
- Thin horizontal progress bar: actual vs target (Reliable only; hidden in Max)
- Efficiency percentage next to bar (Reliable only; "Unlimited" badge in Max)
- Stream counts: "48 ↓ · 12 ↑"

**Center — Server Pool:**
- Three status lines with colored dots: healthy (green), cooldown (amber), blocked (red) — each with a count
- Provider count
- Total active streams

**Right — Engine Log:**
- Scrolling feed of timestamped events, newest at top
- Each line: HH:MM:SS + short message
- Auto-scrolls, pauses on hover
- Subtle monospace styling

### Mode-Specific Differences

| Element | Reliable | Max |
|---------|----------|-----|
| Progress bar | Actual/target with % | Hidden |
| Efficiency | Shown (e.g., "87%") | "Unlimited" badge |
| Speed test events | Appear during periodic re-tests | Never appear |
| Stream label | "Auto-tuned" | "Maximum" |

### Transition Animation

- Toggle slides from center to top-right corner
- Description fades out, grid columns fade in with left→center→right stagger
- CSS-only transitions, ~300ms total, no animation libraries

---

## 3. Backend — Engine Event System

### Event Model

```go
type EngineEvent struct {
    Time    time.Time `json:"time"`
    Kind    string    `json:"kind"`    // "stream", "server", "adjust", "test"
    Message string    `json:"message"` // e.g. "+2 streams (target deficit)"
}
```

### Ring Buffer

- Fixed size: 50 events, shared between download and upload engines
- New events push old ones out
- Thread-safe via `sync.Mutex`
- Stored in a new `internal/events` package (or added to `internal/stats`)

### Event Sources

| Location | Events |
|----------|--------|
| `download/engine.go` auto-adjust | "Added N download streams", "At max streams (64)" |
| `upload/engine.go` auto-adjust | "Added N upload streams" |
| `download/servers.go` health | "hz-de3 entered cooldown (3 failures)", "ovh-fr2 recovered", "vultr-nj blocked" |
| `upload/upload_servers.go` health | Same pattern for upload servers |
| ISP speed test | "ISP speed test starting", "Download: 4.8 Gbps", "Upload: 1.2 Gbps" |

### Delivery

One new field on the existing WebSocket message:

```go
Events []EngineEvent `json:"events,omitempty"`
```

Each 1-second broadcast tick drains new events from the buffer. Frontend accumulates events locally (display buffer of ~100, scrollable). No new API endpoints.

---

## 4. Provider-Grouped Server Accordion

Replaces the flat table on the ServerHealth page for both download and upload sections.

### Provider Header Row

- Chevron: ▾ expanded / ▸ collapsed
- Color-coded dot matching TrafficFlow provider palette
- Provider name
- Server count
- Aggregate speed (sum of all servers in group)
- Health ratio (e.g., "12/12 healthy") — turns amber if any cooldown, red if any blocked

### Expanded Table

Same columns as current flat table (Server, Speed, Streams, Transferred, Status), scoped to one provider. Sortable within each group. Error details and unblock buttons on failed/blocked rows.

### Sorting

- Default: providers sorted by aggregate speed descending
- Secondary: providers with unhealthy servers float to top
- Within each provider: by speed descending (matching current default)

### Interactions

- Click header to expand/collapse individual providers
- "Expand All" / "Collapse All" toggle in the section header
- "Run Speed Test" and "Unblock All" buttons remain in the section header
- Same pattern applies to Upload Servers section

### Implementation

Reuses existing `providerGrouping.ts` (detects 16+ providers, assigns colors). No new detection logic needed.

### Mobile

Providers stack vertically. Expanded tables scroll horizontally.

---

## Component Breakdown

| Component | New/Modified | Purpose |
|-----------|-------------|---------|
| `ControlSurface.tsx` | New | The single morphing panel (idle + running states) |
| `ModeToggle.tsx` | New | Segmented pill toggle for Reliable/Max |
| `ThroughputColumn.tsx` | New | Speed readout, progress bar, efficiency, streams |
| `ServerPoolColumn.tsx` | New | Health counts, provider count, stream total |
| `EngineLog.tsx` | New | Scrolling timestamped event feed |
| `ProviderAccordion.tsx` | New | Grouped server list with collapsible providers |
| `ProviderRow.tsx` | New | Single provider header with aggregate stats |
| `Dashboard.tsx` | Modified | Replace mode cards + start/stop with ControlSurface |
| `ServerHealth.tsx` | Modified | Replace flat tables with ProviderAccordion |
| `useWebSocket.ts` | Modified | Handle new `events` field in WS message |
| `api/client.ts` | Modified | Add EngineEvent type |
| `internal/events/` | New package | Ring buffer + EngineEvent type |
| `internal/api/websocket.go` | Modified | Attach events to WsMessage |
| `internal/download/engine.go` | Modified | Emit events on auto-adjust |
| `internal/download/servers.go` | Modified | Emit events on health changes |
| `internal/upload/engine.go` | Modified | Emit events on auto-adjust |
| `internal/upload/upload_servers.go` | Modified | Emit events on health changes |
