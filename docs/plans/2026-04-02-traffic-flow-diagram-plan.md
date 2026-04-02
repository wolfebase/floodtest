# Traffic Flow Diagram Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Dashboard speed cards with a Canvas-based Sankey flow diagram showing real-time particle animations from download server providers through the user's machine to upload targets.

**Architecture:** A pure TypeScript Canvas renderer (`trafficFlowRenderer.ts`) drives the animation via `requestAnimationFrame`, completely outside React. A React wrapper component (`TrafficFlow.tsx`) manages the Canvas element, data polling, and a `usePageVisibility` hook. Dashboard removes speed cards and embeds the flow diagram as its hero element.

**Tech Stack:** HTML5 Canvas API, TypeScript, React 18, existing WebSocket hook, existing REST API client

---

### Task 1: Create usePageVisibility hook

**Files:**
- Create: `frontend/src/hooks/usePageVisibility.ts`

**Step 1: Write the hook**

```typescript
import { useState, useEffect } from 'react'

export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(!document.hidden)

  useEffect(() => {
    const handler = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return visible
}
```

**Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/hooks/usePageVisibility.ts
git commit -m "feat: add usePageVisibility hook for tab visibility detection"
```

---

### Task 2: Create provider grouping utility

**Files:**
- Create: `frontend/src/utils/providerGrouping.ts`

**Step 1: Write the utility**

This module takes a list of `ServerHealth` items and groups them by provider, aggregating streams, speed, and bytes.

```typescript
import { ServerHealth, UploadServerHealth } from '../api/client'

export interface ProviderGroup {
  name: string
  servers: number
  activeStreams: number
  totalSpeedBps: number
  totalBytes: number
  color: string
}

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

// Distinct colors for up to 16 providers
const PROVIDER_COLORS = [
  '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#fb923c',
  '#facc15', '#60a5fa', '#c084fc', '#4ade80', '#f87171',
  '#38bdf8', '#e879f9', '#2dd4bf', '#fbbf24', '#818cf8', '#a3e635',
]

function extractProvider(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    for (const [pattern, name] of PROVIDER_PATTERNS) {
      if (pattern.test(hostname)) return name
    }
    // Fallback: extract second-level domain
    const parts = hostname.split('.')
    if (parts.length >= 2) {
      return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1)
    }
    return hostname
  } catch {
    return 'Unknown'
  }
}

export function groupDownloadServers(servers: ServerHealth[]): ProviderGroup[] {
  const groups = new Map<string, { servers: number; streams: number; speed: number; bytes: number }>()

  for (const s of servers) {
    if (s.activeStreams <= 0 && s.speedBps <= 0) continue // skip inactive
    const provider = extractProvider(s.url)
    const existing = groups.get(provider) || { servers: 0, streams: 0, speed: 0, bytes: 0 }
    existing.servers++
    existing.streams += s.activeStreams
    existing.speed += s.speedBps
    existing.bytes += s.bytesDownloaded
    groups.set(provider, existing)
  }

  const result: ProviderGroup[] = []
  let colorIdx = 0
  for (const [name, data] of groups) {
    result.push({
      name,
      servers: data.servers,
      activeStreams: data.streams,
      totalSpeedBps: data.speed,
      totalBytes: data.bytes,
      color: PROVIDER_COLORS[colorIdx % PROVIDER_COLORS.length],
    })
    colorIdx++
  }

  // Sort by speed descending
  result.sort((a, b) => b.totalSpeedBps - a.totalSpeedBps)
  return result
}

export function groupUploadServers(servers: UploadServerHealth[]): ProviderGroup[] {
  const groups = new Map<string, { servers: number; streams: number; speed: number; bytes: number }>()

  for (const s of servers) {
    if (s.activeStreams <= 0 && s.speedBps <= 0) continue
    const provider = extractProvider(s.url)
    const existing = groups.get(provider) || { servers: 0, streams: 0, speed: 0, bytes: 0 }
    existing.servers++
    existing.streams += s.activeStreams
    existing.speed += s.speedBps
    existing.bytes += s.bytesUploaded
    groups.set(provider, existing)
  }

  const result: ProviderGroup[] = []
  let colorIdx = 0
  for (const [name, data] of groups) {
    result.push({
      name,
      servers: data.servers,
      activeStreams: data.streams,
      totalSpeedBps: data.speed,
      totalBytes: data.bytes,
      color: PROVIDER_COLORS[colorIdx % PROVIDER_COLORS.length],
    })
    colorIdx++
  }

  result.sort((a, b) => b.totalSpeedBps - a.totalSpeedBps)
  return result
}
```

**Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/utils/providerGrouping.ts
git commit -m "feat: add provider grouping utility for server health data"
```

---

### Task 3: Create the Canvas renderer

**Files:**
- Create: `frontend/src/utils/trafficFlowRenderer.ts`

This is the core rendering engine. It's a pure TypeScript module with zero React dependencies. It takes a Canvas 2D context and data, and draws everything.

**Step 1: Write the renderer**

The renderer needs these capabilities:
- Calculate node positions (left column providers, center machine, right column upload targets)
- Draw rounded-rect nodes with text
- Draw bezier curve pipes between nodes, width proportional to throughput
- Manage a particle system: spawn, advance, draw particles along pipes
- Handle responsive sizing
- Expose an `update(data)` method and a `start()`/`stop()` for the rAF loop

Key interfaces:

```typescript
import { ProviderGroup } from './providerGrouping'

export interface FlowData {
  downloadProviders: ProviderGroup[]
  uploadTargets: ProviderGroup[]
  totalDownloadBps: number
  totalUploadBps: number
  downloadStreams: number
  uploadStreams: number
  uptimeSeconds: number
  sessionDownloadBytes: number
  sessionUploadBytes: number
  healthyServers: number
  totalServers: number
  running: boolean
}

interface NodeRect {
  x: number; y: number; w: number; h: number
  label: string; sublabel: string; color: string
}

interface Pipe {
  from: NodeRect; to: NodeRect
  throughputBps: number; color: string; maxBps: number
}

interface Particle {
  pipeIndex: number; t: number; speed: number
}
```

The renderer class:

```typescript
export class TrafficFlowRenderer {
  private ctx: CanvasRenderingContext2D
  private width = 0
  private height = 0
  private dpr = 1
  private animId = 0
  private data: FlowData = { /* defaults */ }
  private particles: Particle[] = []
  private lastFrame = 0

  constructor(canvas: HTMLCanvasElement) { /* store ctx, measure dpr */ }

  resize(w: number, h: number) { /* set canvas size accounting for dpr */ }

  update(data: FlowData) { /* store new data, recompute pipes if providers changed */ }

  start() { /* kick off rAF loop */ }
  stop() { /* cancel rAF */ }

  private frame(timestamp: number) {
    const dt = (timestamp - this.lastFrame) / 1000
    this.lastFrame = timestamp
    this.ctx.clearRect(0, 0, this.width, this.height)
    const nodes = this.layoutNodes()
    const pipes = this.layoutPipes(nodes)
    this.drawPipes(pipes)
    this.updateParticles(pipes, dt)
    this.drawParticles(pipes)
    this.drawNodes(nodes)
    this.animId = requestAnimationFrame((t) => this.frame(t))
  }

  // ... private methods for layout, drawing, particle physics
}
```

Write the full implementation with:
- **Node layout**: Left column nodes spaced vertically with 8px gaps. Center node at `width/2`. Right column nodes mirrored. Nodes sized to fit their text content with padding.
- **Pipe drawing**: Cubic bezier from right edge of left node to left edge of center node. Width = `max(2, min(16, throughput / maxThroughput * 16))`. Color with 60% opacity for the pipe fill, 100% for the particle.
- **Particle system**: For each pipe, maintain particles. Spawn rate proportional to throughput (1-20 particles per second per pipe). Each particle has a `t` parameter 0→1 along the bezier. Advance `t` by `speed * dt`. Speed proportional to throughput. When `t >= 1`, recycle to `t = 0`. Draw as small circles with glow (via `shadowBlur`).
- **Center node**: Draw larger with a subtle gradient border. Display formatted stats inside using `ctx.fillText`.
- **Stopped state**: Draw all nodes but no particles, pipes at 20% opacity.
- **Helper functions**: `formatSpeed(bps)`, `formatBytes(bytes)`, `formatDuration(seconds)` — same logic as Dashboard but for Canvas text rendering.

**Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/utils/trafficFlowRenderer.ts
git commit -m "feat: add Canvas traffic flow renderer with particle animation"
```

---

### Task 4: Create the TrafficFlow React component

**Files:**
- Create: `frontend/src/components/TrafficFlow.tsx`

**Step 1: Write the component**

```typescript
import { useEffect, useRef, useCallback } from 'react'
import { WsStats } from '../hooks/useWebSocket'
import { usePageVisibility } from '../hooks/usePageVisibility'
import { api, ServerHealth, UploadServerHealth } from '../api/client'
import { groupDownloadServers, groupUploadServers } from '../utils/providerGrouping'
import { TrafficFlowRenderer, FlowData } from '../utils/trafficFlowRenderer'

interface Props {
  stats: WsStats
}

export default function TrafficFlow({ stats }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<TrafficFlowRenderer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const visible = usePageVisibility()
  const serverDataRef = useRef<{ dl: ServerHealth[]; ul: UploadServerHealth[] }>({ dl: [], ul: [] })

  // Initialize renderer
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    rendererRef.current = new TrafficFlowRenderer(canvas)
    return () => { rendererRef.current?.stop() }
  }, [])

  // Handle resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect
      const height = window.innerWidth < 640 ? 400 : 300
      rendererRef.current?.resize(width, height)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Start/stop animation based on tab visibility
  useEffect(() => {
    if (visible) {
      rendererRef.current?.start()
    } else {
      rendererRef.current?.stop()
    }
  }, [visible])

  // Poll server health every 5 seconds
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const [dl, ul] = await Promise.all([
          api.getServerHealth(),
          api.getUploadServerHealth(),
        ])
        serverDataRef.current = { dl, ul }
      } catch { /* ignore */ }
    }
    fetchServers()
    const interval = setInterval(fetchServers, 5000)
    return () => clearInterval(interval)
  }, [])

  // Push data to renderer on every WebSocket update (avoids React re-render of canvas)
  useEffect(() => {
    const { dl, ul } = serverDataRef.current
    const flowData: FlowData = {
      downloadProviders: groupDownloadServers(dl),
      uploadTargets: groupUploadServers(ul),
      totalDownloadBps: stats.downloadBps,
      totalUploadBps: stats.uploadBps,
      downloadStreams: stats.downloadStreams,
      uploadStreams: stats.uploadStreams,
      uptimeSeconds: stats.uptimeSeconds,
      sessionDownloadBytes: stats.sessionDownloadBytes,
      sessionUploadBytes: stats.sessionUploadBytes,
      healthyServers: stats.healthyServers,
      totalServers: stats.totalServers,
      running: stats.running,
    }
    rendererRef.current?.update(flowData)
  }, [stats])

  return (
    <div ref={containerRef} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <canvas ref={canvasRef} className="w-full" style={{ height: 300 }} />
    </div>
  )
}
```

**Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add frontend/src/components/TrafficFlow.tsx
git commit -m "feat: add TrafficFlow React component wrapping Canvas renderer"
```

---

### Task 5: Integrate into Dashboard and remove speed cards

**Files:**
- Modify: `frontend/src/components/Dashboard.tsx`

**Step 1: Modify Dashboard**

Changes needed:
1. Add import: `import TrafficFlow from './TrafficFlow'`
2. Remove the speed cards section (lines 316-379 — the `grid grid-cols-1 md:grid-cols-2` containing Download and Upload speed cards)
3. Add `<TrafficFlow stats={stats} />` between the ISP speed test progress bar and the cumulative usage section
4. Remove the now-unused `speedContextLine` function and related variables (`downloadTargetMbps`, `uploadTargetMbps`, `hasMeasurements` if only used by speed cards — check first)
5. Keep `formatSpeed`, `formatBytes`, `formatDuration` as they're used by the usage grid

The Dashboard layout becomes:
```
Header → Mode Selector → Start/Stop → ISP Test Progress → TrafficFlow → Usage Grid → ServerHealth
```

**Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Run frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All pass

**Step 4: Check E2E tests**

Read `e2e/tests/smoke.spec.ts` and verify no locators reference the removed speed cards. The test `shows download and upload speed cards` uses `page.getByText('Download', { exact: true })` and `page.getByText('Upload', { exact: true })` — these may need updating since the speed cards are removed. The words "Download" and "Upload" will still appear in the flow diagram Canvas (rendered via `fillText`, invisible to Playwright). Update the E2E test to check for the Canvas element instead:

```typescript
test('shows traffic flow diagram', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('canvas')).toBeVisible()
})
```

**Step 5: Commit**

```bash
git add frontend/src/components/Dashboard.tsx e2e/tests/smoke.spec.ts
git commit -m "feat: integrate TrafficFlow into Dashboard, remove speed cards"
```

---

### Task 6: Build, embed, and verify

**Files:**
- No new files

**Step 1: Run all frontend tests**

Run: `cd frontend && npx vitest run`
Expected: All pass

**Step 2: Type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

**Step 3: Build frontend**

Run: `cd frontend && npm run build`
Expected: Build succeeds

**Step 4: Embed and build Go binary**

Run: `rm -rf cmd/server/frontend/dist && cp -r frontend/dist cmd/server/frontend/dist && go build -o /tmp/wansaturator ./cmd/server`
Expected: Build succeeds

**Step 5: Run Go tests**

Run: `go test -race ./...`
Expected: All pass

**Step 6: Commit**

```bash
git add cmd/server/frontend/dist
git commit -m "chore: update embedded frontend build with traffic flow diagram"
```

---

### Task 7: Visual testing and polish

**Files:**
- Possibly modify: `frontend/src/utils/trafficFlowRenderer.ts`
- Possibly modify: `frontend/src/components/TrafficFlow.tsx`

**Step 1: Start dev server and visually inspect**

Run: `cd frontend && npm run dev`

Open `http://localhost:5173` and verify:
- Flow diagram renders with the dark theme (slate-900 background)
- When stopped: nodes visible, pipes dimmed, no particles, center shows "Stopped"
- When running: particles animate smoothly along pipes
- Download provider nodes appear on the left grouped correctly
- Upload target nodes appear on the right
- Center node shows all stats (speeds, streams, uptime, session bytes, server counts)
- Pipe widths scale with throughput
- Particle speed scales with throughput
- Resizing the browser window recalculates node positions
- Switching to another tab and back: animation resumes immediately, no stale data

**Step 2: Fix any visual issues found**

Adjust spacing, colors, font sizes, node sizing, particle density as needed.

**Step 3: Rebuild and commit if changes were made**

```bash
cd frontend && npm run build
cd .. && rm -rf cmd/server/frontend/dist && cp -r frontend/dist cmd/server/frontend/dist
git add frontend/src cmd/server/frontend/dist
git commit -m "fix: polish traffic flow diagram visual appearance"
```

---

### Task 8: Push and verify CI

**Step 1: Push to GitHub**

```bash
git push origin main
```

**Step 2: Monitor CI**

Run: `gh run list --limit 1`
Watch: `gh run watch <id> --exit-status`
Expected: All jobs pass (test + build)

**Step 3: Update server if needed**

SSH to `tyler@10.0.10.205` and pull the new image:
```bash
sudo docker compose -f /opt/floodtest/docker-compose.yml pull
sudo docker compose -f /opt/floodtest/docker-compose.yml up -d
```
