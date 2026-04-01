<div align="center">

# FloodTest

**ISP Throttle Detection Tool**

Saturates your WAN connection in both directions to detect if your ISP throttles after sustained heavy usage.

[![Docker Image](https://img.shields.io/badge/ghcr.io-floodtest-blue?logo=docker&logoColor=white)](https://github.com/twolfekc/floodtest/pkgs/container/floodtest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-linux%20%7C%20docker-lightgrey)](https://github.com/twolfekc/floodtest)
[![Image Size](https://img.shields.io/badge/image%20size-~23MB-blue)](https://github.com/twolfekc/floodtest/pkgs/container/floodtest)

</div>

---

## What It Does

FloodTest generates **real WAN traffic** that registers on your ISP's usage meter. It downloads from 22+ public speed test servers worldwide and uploads to Backblaze B2 cloud storage simultaneously, logging throughput over time to detect if and when your ISP starts throttling.

| | Feature |
|---|---|
| :arrow_down: | **Download saturation** — 22+ global speed test servers with automatic rotation and failover |
| :arrow_up: | **Upload saturation** — Backblaze B2 free-tier uploads, objects deleted immediately |
| :chart_with_upwards_trend: | **Real-time dashboard** — Live throughput, server health, cumulative usage |
| :bar_chart: | **Historical charts** — 90 days of throughput history with throttle event overlay |
| :rotating_light: | **Throttle detection** — Automatic alerts when speed drops below your target |
| :green_circle: | **Server health** — See which download servers are healthy, blocked, or cooling down |
| :calendar: | **Scheduler** — Automate test runs by day and time |
| :control_knobs: | **Rate limiting** — Set precise bandwidth targets per direction |
| :package: | **Self-contained** — Single 23MB Docker container, no external dependencies |

---

## Install (Ubuntu)

```bash
curl -fsSL https://raw.githubusercontent.com/twolfekc/floodtest/main/install.sh | sudo bash
```

Installs Docker (if needed), opens the firewall port, and starts FloodTest on port **7860**.

Open `http://your-server-ip:7860` to configure.

## Update

```bash
curl -fsSL https://raw.githubusercontent.com/twolfekc/floodtest/main/update.sh | sudo bash
```

Pulls the latest image and restarts. Settings, schedules, and history are preserved.

---

## System Requirements

| | Minimum | Recommended (1 Gbps) | Recommended (5+ Gbps) |
|---|---|---|---|
| **CPU** | 1 core | 2 cores | 4+ cores |
| **RAM** | 512 MB | 1 GB | 2 GB |
| **Disk** | 1 GB | 2 GB | 2 GB |
| **Network** | Any WAN connection | 1 Gbps symmetric | 5-10 Gbps symmetric |

**Notes:**
- CPU is the main bottleneck at high speeds — each parallel download stream needs its own goroutine
- Disk is only used for the SQLite database (settings + 90 days of history). All download data goes to `/dev/null` and upload data is generated in memory
- Must have real WAN connectivity (not NAT loopback)
- **OS**: Ubuntu 20.04+ (install script), any Linux with Docker (manual install), Unraid, macOS (dev only)

---

## Manual Install

<details>
<summary>If you already have Docker and Docker Compose</summary>

```bash
mkdir -p /opt/floodtest && cd /opt/floodtest
```

Create a `docker-compose.yml`:

```yaml
services:
  floodtest:
    image: ghcr.io/twolfekc/floodtest:latest
    container_name: floodtest
    restart: unless-stopped
    ports:
      - "7860:7860"
    volumes:
      - floodtest-data:/data
    environment:
      - DATA_DIR=/data

volumes:
  floodtest-data:
```

Then:

```bash
docker compose up -d
```

Open `http://localhost:7860` in your browser.

</details>

---

## Backblaze B2 Setup

<details>
<summary>How to create a free B2 account for uploads</summary>

FloodTest uses Backblaze B2 for uploads because ingress is free and unlimited:

1. Create a [Backblaze B2 account](https://www.backblaze.com/b2/sign-up.html) (free)
2. Create a bucket:
   - Go to **Buckets** → **Create a Bucket**
   - Name it something like `floodtest-uploads`
   - Set to **Private**
3. Create an Application Key:
   - Go to **Application Keys** → **Add a New Application Key**
   - Restrict it to the bucket you created
   - Save the **keyID** and **applicationKey** (shown only once)
4. Enter these credentials in the FloodTest setup wizard

</details>

---

## How It Works

<details>
<summary>Architecture and engine details</summary>

### Download Engine
Downloads large files (1-10GB) from 22+ public speed test servers in parallel, discarding data to `/dev/null`. Automatically rotates between servers with exponential backoff when one fails or blocks.

### Upload Engine
Generates random data in memory and uploads to B2 via the S3-compatible API. Each object is deleted immediately after upload, keeping storage at ~0. Uses `io.Pipe` for zero-copy streaming.

### Throttle Detection
Monitors rolling average throughput. When it drops below a configurable percentage (default 60%) of the target speed for more than 5 minutes, it logs a throttle event with timestamps and duration.

### Server Health
Each download server is independently tracked. Failed connections trigger exponential backoff (5min → 10min → 20min → 30min cap). The dashboard shows real-time server status.

### Stack
| Layer | Technology |
|---|---|
| Backend | Go — goroutines for high-concurrency streaming |
| Frontend | React + TypeScript + Tailwind CSS + Recharts |
| Database | SQLite (persisted in Docker volume) |
| Real-time | WebSocket push every 1 second |
| Container | 23MB distroless image (multi-arch: amd64 + arm64) |

</details>

---

## Environment Variables

<details>
<summary>All configurable options</summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `B2_KEY_ID` | | Backblaze B2 application key ID |
| `B2_APP_KEY` | | Backblaze B2 application key |
| `B2_BUCKET_NAME` | | B2 bucket name |
| `B2_ENDPOINT` | `https://s3.us-west-002.backblazeb2.com` | B2 S3-compatible endpoint |
| `WEB_PORT` | `7860` | Web UI port |
| `DEFAULT_DOWNLOAD_SPEED` | `5000` | Default download target (Mbps) |
| `DEFAULT_UPLOAD_SPEED` | `5000` | Default upload target (Mbps) |

All settings can also be configured through the web UI.

</details>

---

## Unraid

1. Add the container via Docker Compose or Unraid's Docker UI
2. Image: `ghcr.io/twolfekc/floodtest:latest`
3. Map port **7860**
4. Create a path mapping for `/data` to persist settings and history
5. Configure through the web UI setup wizard

---

## Docker Image

```
ghcr.io/twolfekc/floodtest:latest
```

Multi-architecture: `linux/amd64` and `linux/arm64`.

---

## License

MIT
