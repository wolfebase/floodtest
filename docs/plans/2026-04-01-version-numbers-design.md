# Date-Based Version Numbers

**Date:** 2026-04-01
**Goal:** Replace cryptic SHA digests with human-readable version strings like `2026.04.01-1` in the Updates UI.

## How It Works

1. CI injects version string via `-ldflags` at build time. Format: `YYYY.MM.DD-N` (date + short SHA).
2. Go binary exposes `version.Version` and `version.BuildDate` variables, defaulting to `"dev"` for local builds.
3. Updater fetches the latest version label from the Docker registry alongside the digest.
4. Frontend displays version strings instead of digests.
5. Docker image labeled with `org.opencontainers.image.version` for `docker inspect`.

## Changes

| File | Change |
|------|--------|
| `internal/version/version.go` | New package: `Version`, `BuildDate` vars set via ldflags |
| `.github/workflows/build.yml` | Add `--build-arg VERSION=...` and ldflags to Go build |
| `Dockerfile` | Accept `VERSION` build arg, pass to `go build -ldflags` |
| `internal/updater/updater.go` | Add `currentVersion` field, fetch latest version label from registry |
| `internal/api/handlers.go` | Include version in status endpoint |
| `frontend/src/api/client.ts` | Add `currentVersion`, `latestVersion` to UpdateStatus |
| `frontend/src/components/Updates.tsx` | Display version strings instead of digests |
