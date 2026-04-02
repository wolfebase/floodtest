# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
# Frontend (React + Vite + Tailwind)
cd frontend && npm ci && npm run build    # production build to frontend/dist/
cd frontend && npx tsc --noEmit           # type-check only
cd frontend && npm run dev                # dev server (proxies API to :7860)

# Go backend (requires frontend built first)
cp -r frontend/dist cmd/server/frontend/dist   # copy built frontend for embedding
go build -o wansaturator ./cmd/server           # build binary

# Docker (builds everything)
docker compose build
docker compose up -d
```

The Go binary embeds the React frontend via `//go:embed all:frontend/dist` in `cmd/server/main.go`. The embed path is relative to `cmd/server/`, so the built frontend must be at `cmd/server/frontend/dist/`.

## Architecture

**Single Go binary** serving an embedded React SPA, SQLite database, and WebSocket real-time stats. Runs in a 23MB distroless Docker container.

### Backend packages (`internal/`)

| Package | Purpose |
|---------|---------|
| `api` | HTTP router (Go 1.22 `net/http` patterns), REST handlers, WebSocket hub |
| `config` | Settings loaded from env vars → SQLite fallback. Thread-safe via `sync.RWMutex` |
| `db` | SQLite (pure Go `modernc.org/sqlite`, WAL mode). Singleton via `sync.Once` |
| `download` | Parallel HTTP download engine. Goroutine pool with token-bucket rate limiting |
| `upload` | Parallel B2 upload engine via S3 API. Generates random data, uploads, deletes immediately |
| `stats` | Atomic byte counters, 1-second snapshots, 60-second persistence to SQLite, 90-day retention |
| `throttle` | Compares rolling average throughput vs target. Logs events when below threshold |
| `scheduler` | Time/day schedule matching. Controls engine start/stop with manual override |
| `updater` | Queries GHCR for new image digest. Self-updates via Docker socket + helper container |

### Key patterns

- **Engine interfaces**: Download and upload engines expose `StatsCollector` interfaces (`AddDownloadBytes`/`AddUploadBytes`) that the stats collector implements. No circular dependencies.
- **Callback wiring**: `api.App` struct uses function fields (not interfaces) for engine control. `main.go` wires closures that capture the engine instances.
- **Auto-adjust**: Each engine has an `autoAdjust()` goroutine that monitors throughput every 10s and launches new stream goroutines if below 80% of target (up to 64 max).
- **Server health**: Download servers tracked with exponential backoff (5min → 30min cap). `AddBytes()` updates counters incrementally during streaming, not just on completion.
- **Self-update**: Uses Docker SDK to pull new image, then launches a `docker:cli` helper container that runs `docker compose up -d --force-recreate` to replace the running container.

### Frontend (`frontend/src/`)

React 18 + TypeScript SPA with dark Tailwind theme. Pages: Dashboard, Charts (Recharts), Schedule, Settings, Updates, ServerHealth. Real-time data via WebSocket hook (`useWebSocket.ts`). API client in `api/client.ts`.

### Data flow

1. Engines write bytes to atomic counters in `stats.Collector`
2. Collector's 1-second ticker computes rates, stores snapshots
3. WebSocket broadcaster (in `main.go`) reads `CurrentRate()` every second, pushes to all clients
4. Collector's 60-second ticker persists to `throughput_history` table and upserts `usage_counters`

## Configuration

Default port: **7860**. Settings persist in SQLite at `$DATA_DIR/wansaturator.db`. Environment variables override DB values on startup (see `config.go` `New()`). B2 upload is optional — app runs download-only if B2 credentials aren't configured.

## Deployment

- **GitHub repo**: `twolfekc/floodtest`
- **Container image**: `ghcr.io/twolfekc/floodtest:latest` (multi-arch amd64+arm64)
- **CI**: `.github/workflows/build.yml` builds and pushes on every push to `main`
- **Install script**: `install.sh` — standalone, writes compose file to `/opt/floodtest/`, installs Docker
- **Docker socket**: Mounted for self-update feature. `COMPOSE_DIR` env var tells updater where the compose file lives.

## Testing

```bash
go test -race ./...                    # Go unit tests (74 tests, ~1s)
cd frontend && npx vitest run          # Frontend tests (12 tests, ~0.5s)
cd e2e && npx playwright test          # E2E smoke tests (8 tests, needs built binary)
```

Test files use `db.OpenDB(":memory:")` for isolated in-memory SQLite — never use `db.Open()` in tests. Test packages: db, config, scheduler, stats, throttle, api, download.

CI pipeline (`.github/workflows/build.yml`) runs all test tiers and gates Docker builds.

## Design Documents

Design docs live in `docs/plans/` with naming `YYYY-MM-DD-<topic>-{design,plan}.md`. Key docs:
- `server-ranking-research.md` — 44 new servers, EWMA ranking algorithm, per-provider limits
- `full-stack-test-suite-{design,plan}.md` — test pyramid architecture (implemented)
- `smart-auto-modes-{design,plan}.md` — Reliable/Max modes (implemented)
- `multi-mode-upload-{design,plan}.md` — HTTP/S3/local upload modes (partially implemented)

## Security Status

OWASP audit completed 2026-04-01. **3 CRITICAL findings remain unpatched:**
1. No authentication on any API endpoint
2. B2/S3 credentials exposed via GET /api/settings
3. Unauthenticated Docker socket access via update API

See `docs/plans/` or auto memory for full findings. Security hardening should precede new features.
