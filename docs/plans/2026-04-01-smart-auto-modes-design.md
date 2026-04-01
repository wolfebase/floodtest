# Smart Auto Modes

**Date:** 2026-04-01
**Goal:** Replace manual configuration with intelligent auto-modes. One-click start that measures ISP speed and auto-configures everything. Two modes: Reliable (safe, sustained) and Max (no limits).

## Two Modes

### Reliable Mode (default)

- On start, pauses traffic, runs a proper speed test, auto-configures everything
- Targets 90% of measured capacity (leaves headroom)
- Stream count: `clamp(measuredMbps / 50, 4, 32)`
- Uses only healthy servers weighted by speed score
- Rate-limited to auto-detected target
- Respects server health, backs off on failures
- Re-tests every 6 hours, adjusts if speed changed >20%

### Max Mode

- No speed test — starts immediately
- No rate limiting (rateLimitBps = 0)
- Max streams: 64 download, 32 upload
- All servers enabled, cooldowns reset
- No backing off on upload endpoints
- Goal: push as hard as the hardware allows

## Speed Test Methodology

### Pause-and-Test (only accurate approach)

1. **Pause engines** — stop all download/upload traffic
2. **Wait 2s** — TCP drain
3. **Download test** — 8 parallel HTTP GETs to `speed.cloudflare.com/__down?bytes=100000000`, 3s warm-up discard, 10s measurement window, 200ms sample intervals
4. **Upload test** — 8 parallel HTTP POSTs to `speed.cloudflare.com/__up` with 10MB payloads, same 3s warm-up + 10s measurement
5. **Calculate** — trimmed mean: sort 200ms samples, discard bottom 25% and top 25%, average the middle
6. **Resume engines** with auto-configured settings

Total pause: ~28 seconds. Negligible for 24/7 operation.

### When Speed Tests Run

- First start in Reliable mode (before engines launch)
- Every 6 hours (pause → test → resume → adjust if >20% change)
- On-demand via UI button

### Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Parallel streams | 8 | Ookla standard, overcomes per-TCP limits |
| Warm-up discard | 3 seconds | TCP ramp-up excluded from results |
| Measurement duration | 10 seconds | Industry consensus minimum |
| Sample interval | 200ms | Captures TCP dynamics without noise |
| Trim percentage | 25% each end | Removes outliers (Ookla uses ~30%) |
| Re-test interval | 6 hours | Catches time-of-day variation |
| TCP drain wait | 2 seconds | Ensures clean measurement |

### Result Calculation

```
collect 200ms throughput samples during 10s measurement window
→ ~50 samples per direction
→ sort ascending
→ discard samples[0..12] and samples[37..49] (bottom/top 25%)
→ average samples[13..36] = trimmed mean
→ that's the reported speed
```

## Backend Changes

### New file: `internal/speedtest/speedtest.go`

Proper ISP speed test module (distinct from the server-probing speed test in `download/speedtest.go`). That existing speed test probes individual servers with 10MB downloads. This new one measures actual ISP capacity with:
- Multi-stream parallel downloads/uploads to Cloudflare
- Warm-up discard
- 200ms sampling
- Trimmed mean calculation
- Pause/resume integration

### Modified: `internal/config/config.go`

- Add `AutoMode string` field: `"reliable"` or `"max"` (default: `"reliable"`)
- Add `LastSpeedTestDownloadMbps int` and `LastSpeedTestUploadMbps int` (persisted results)
- Add `LastSpeedTestTime string` (ISO timestamp)

### Modified: `cmd/server/main.go`

- `startEngines` reads `AutoMode` from config
- Reliable mode: runs speed test first, then auto-configures targets/streams/rate limits
- Max mode: sets no rate limit, max streams, starts immediately
- Add periodic speed test goroutine (6-hour interval, Reliable mode only)
- Speed test pauses engines, runs test, resumes with new settings

### Modified: `internal/api/handlers.go`

- `HandleStart` accepts optional `mode` parameter (or uses saved mode)
- New `GET /api/speed-test-results` endpoint returning last test results
- New `POST /api/run-speed-test` endpoint to trigger on-demand test

### Modified: `internal/api/websocket.go`

- Add `autoMode`, `measuredDownloadMbps`, `measuredUploadMbps` to WsMessage

### Frontend changes

#### Dashboard overhaul

- Replace current Start/Stop with speed inputs with:
  - **Mode selector**: Two cards — "Reliable" and "Max"
  - **Start/Stop button**: Single button, one click
  - **Status line**: "Measuring speed..." during test, "Running at X/Y Mbps (auto-tuned)" after
- Current manual speed targets move to "Advanced" collapsible section

#### Settings

- Add `autoMode` field (persisted)
- Show last speed test results (measured download/upload, timestamp)

## Data Flow

```
User clicks Start
  → if Reliable:
      → pause engines (if running)
      → run ISP speed test (28s)
      → calculate targets (90% of measured)
      → calculate streams (measuredMbps / 50, clamped 4-32)
      → start engines with auto settings
      → schedule re-test every 6 hours
  → if Max:
      → reset all server cooldowns
      → start engines: 64 dl streams, 32 ul streams, no rate limit
      → no speed test, no re-testing
```
