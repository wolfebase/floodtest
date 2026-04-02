import { ProviderGroup } from './providerGrouping'

// ---------------------------------------------------------------------------
// Data interface
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Point {
  x: number
  y: number
}

interface NodeRect {
  x: number
  y: number
  w: number
  h: number
  color: string
  name: string
  detail: string
}

interface Particle {
  t: number
  speed: number
}

interface Pipe {
  from: NodeRect
  to: NodeRect
  color: string
  throughputFraction: number
  particles: Particle[]
  spawnAccum: number
}

// ---------------------------------------------------------------------------
// Helpers (pure, no side effects)
// ---------------------------------------------------------------------------

function formatSpeed(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`
  return `${(bps / 1e3).toFixed(0)} Kbps`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${(bytes / 1e6).toFixed(1)} MB`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}h ${m}m ${s}s`
}

function bezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLORS = {
  downloadAccent: '#22d3ee',
  uploadAccent: '#a78bfa',
  nodeBg: '#1e293b',
  nodeBorder: '#374151',
  textPrimary: '#ffffff',
  textSecondary: '#9ca3af',
  textDim: '#6b7280',
  healthy: '#34d399',
  warning: '#fbbf24',
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class TrafficFlowRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private width = 0
  private height = 0
  private dpr = 1
  private animId = 0
  private lastFrame = 0
  private data: FlowData | null = null

  // Layout caches
  private downloadNodes: NodeRect[] = []
  private uploadNodes: NodeRect[] = []
  private centerNode: NodeRect = { x: 0, y: 0, w: 0, h: 0, color: '', name: '', detail: '' }

  // Pipe state
  private downloadPipes: Pipe[] = []
  private uploadPipes: Pipe[] = []

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2d context')
    this.ctx = ctx
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  resize(width: number, height: number): void {
    this.dpr = window.devicePixelRatio || 1
    this.width = width
    this.height = height
    this.canvas.width = width * this.dpr
    this.canvas.height = height * this.dpr
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.rebuildLayout()
  }

  update(data: FlowData): void {
    const prevData = this.data
    this.data = data

    // Rebuild layout if provider list changes
    const prevDl = prevData?.downloadProviders.map((p) => p.name).join(',') ?? ''
    const prevUl = prevData?.uploadTargets.map((p) => p.name).join(',') ?? ''
    const newDl = data.downloadProviders.map((p) => p.name).join(',')
    const newUl = data.uploadTargets.map((p) => p.name).join(',')

    if (prevDl !== newDl || prevUl !== newUl) {
      this.rebuildLayout()
    }

    // Update throughput fractions
    this.syncPipes()

    // When stopped, clear all particles
    if (!data.running) {
      for (const pipe of [...this.downloadPipes, ...this.uploadPipes]) {
        pipe.particles.length = 0
        pipe.spawnAccum = 0
      }
    }
  }

  start(): void {
    if (this.animId) return
    this.lastFrame = performance.now()
    this.animId = requestAnimationFrame(this.frame)
  }

  stop(): void {
    if (this.animId) {
      cancelAnimationFrame(this.animId)
      this.animId = 0
    }
  }

  // -----------------------------------------------------------------------
  // Layout
  // -----------------------------------------------------------------------

  private get isMobile(): boolean {
    return this.width < 640
  }

  private rebuildLayout(): void {
    if (!this.data) return

    const activeDownloads = this.data.downloadProviders.filter((p) => p.activeStreams > 0)
    const activeUploads = this.data.uploadTargets.filter((p) => p.activeStreams > 0)

    if (this.isMobile) {
      this.buildVerticalLayout(activeDownloads, activeUploads)
    } else {
      this.buildHorizontalLayout(activeDownloads, activeUploads)
    }

    this.rebuildPipes()
  }

  private buildHorizontalLayout(downloads: ProviderGroup[], uploads: ProviderGroup[]): void {
    const margin = 20
    const colWidth = this.width * 0.25
    const nodeW = Math.min(140, colWidth - margin)
    const nodeH = 50
    const gap = 8
    const centerW = 200
    const centerH = 180

    // Center node
    const cx = this.width / 2 - centerW / 2
    const cy = this.height / 2 - centerH / 2
    this.centerNode = { x: cx, y: cy, w: centerW, h: centerH, color: '', name: 'center', detail: '' }

    // Left column (download providers)
    this.downloadNodes = this.stackNodes(
      downloads,
      margin + (colWidth - nodeW) / 2,
      nodeW,
      nodeH,
      gap,
      this.height,
    )

    // Right column (upload targets)
    this.uploadNodes = this.stackNodes(
      uploads,
      this.width - margin - colWidth + (colWidth - nodeW) / 2,
      nodeW,
      nodeH,
      gap,
      this.height,
    )
  }

  private buildVerticalLayout(downloads: ProviderGroup[], uploads: ProviderGroup[]): void {
    const margin = 16
    const nodeW = Math.min(140, (this.width - margin * 2) / Math.max(downloads.length, 1) - 8)
    const nodeH = 50
    const gap = 8
    const centerW = Math.min(200, this.width - margin * 2)
    const centerH = 160

    // Vertical thirds
    const sectionH = this.height / 3

    // Center node in middle third
    const cx = this.width / 2 - centerW / 2
    const cy = sectionH + (sectionH - centerH) / 2
    this.centerNode = { x: cx, y: cy, w: centerW, h: centerH, color: '', name: 'center', detail: '' }

    // Download nodes in top section - horizontal row
    this.downloadNodes = this.rowNodes(downloads, margin, nodeW, nodeH, gap, sectionH, this.width)

    // Upload nodes in bottom section - horizontal row
    this.uploadNodes = this.rowNodes(uploads, margin, nodeW, nodeH, gap, sectionH * 2 + (sectionH - nodeH) / 2, this.width)
  }

  private stackNodes(
    providers: ProviderGroup[],
    x: number,
    w: number,
    h: number,
    gap: number,
    canvasH: number,
  ): NodeRect[] {
    const totalH = providers.length * h + (providers.length - 1) * gap
    let startY = (canvasH - totalH) / 2
    if (startY < 8) startY = 8

    return providers.map((p, i) => ({
      x,
      y: startY + i * (h + gap),
      w,
      h,
      color: p.color,
      name: p.name,
      detail: `${p.activeStreams} streams  ${formatSpeed(p.totalSpeedBps)}`,
    }))
  }

  private rowNodes(
    providers: ProviderGroup[],
    margin: number,
    w: number,
    h: number,
    gap: number,
    baseY: number,
    canvasW: number,
  ): NodeRect[] {
    const totalW = providers.length * w + (providers.length - 1) * gap
    let startX = (canvasW - totalW) / 2
    if (startX < margin) startX = margin

    return providers.map((p, i) => ({
      x: startX + i * (w + gap),
      y: baseY,
      w,
      h,
      color: p.color,
      name: p.name,
      detail: `${p.activeStreams} streams  ${formatSpeed(p.totalSpeedBps)}`,
    }))
  }

  // -----------------------------------------------------------------------
  // Pipes
  // -----------------------------------------------------------------------

  private rebuildPipes(): void {
    // Preserve existing particle state by matching on pipe index
    const oldDl = this.downloadPipes
    const oldUl = this.uploadPipes

    this.downloadPipes = this.downloadNodes.map((node, i) => ({
      from: node,
      to: this.centerNode,
      color: node.color,
      throughputFraction: 0,
      particles: oldDl[i]?.particles ?? [],
      spawnAccum: oldDl[i]?.spawnAccum ?? 0,
    }))

    this.uploadPipes = this.uploadNodes.map((node, i) => ({
      from: this.centerNode,
      to: node,
      color: node.color,
      throughputFraction: 0,
      particles: oldUl[i]?.particles ?? [],
      spawnAccum: oldUl[i]?.spawnAccum ?? 0,
    }))
  }

  private syncPipes(): void {
    if (!this.data) return

    const totalDlStreams = this.data.downloadStreams || 1
    const totalUlStreams = this.data.uploadStreams || 1
    const maxBps = Math.max(this.data.totalDownloadBps, this.data.totalUploadBps, 1)

    for (let i = 0; i < this.downloadPipes.length; i++) {
      const provider = this.data.downloadProviders[i]
      if (provider) {
        // Distribute total download Bps proportionally by stream count
        const streamRatio = provider.activeStreams / totalDlStreams
        const estimatedBps = this.data.totalDownloadBps * streamRatio
        this.downloadPipes[i].throughputFraction = estimatedBps / maxBps
        this.downloadPipes[i].from.detail = `${provider.activeStreams} streams  ${formatSpeed(estimatedBps)}`
      }
    }

    for (let i = 0; i < this.uploadPipes.length; i++) {
      const provider = this.data.uploadTargets[i]
      if (provider) {
        const streamRatio = provider.activeStreams / totalUlStreams
        const estimatedBps = this.data.totalUploadBps * streamRatio
        this.uploadPipes[i].throughputFraction = estimatedBps / maxBps
        this.uploadPipes[i].to.detail = `${provider.activeStreams} streams  ${formatSpeed(estimatedBps)}`
      }
    }
  }

  // -----------------------------------------------------------------------
  // Pipe geometry
  // -----------------------------------------------------------------------

  private pipeControlPoints(pipe: Pipe): [Point, Point, Point, Point] {
    const from = pipe.from
    const to = pipe.to

    if (this.isMobile) {
      // Vertical flow: connect bottom of from → top of to
      const p0: Point = { x: from.x + from.w / 2, y: from.y + from.h }
      const p3: Point = { x: to.x + to.w / 2, y: to.y }
      const dy = (p3.y - p0.y) * 0.4
      const p1: Point = { x: p0.x, y: p0.y + dy }
      const p2: Point = { x: p3.x, y: p3.y - dy }
      return [p0, p1, p2, p3]
    } else {
      // Horizontal flow: connect right edge of from → left edge of to
      const p0: Point = { x: from.x + from.w, y: from.y + from.h / 2 }
      const p3: Point = { x: to.x, y: to.y + to.h / 2 }
      const dx = (p3.x - p0.x) * 0.4
      const p1: Point = { x: p0.x + dx, y: p0.y }
      const p2: Point = { x: p3.x - dx, y: p3.y }
      return [p0, p1, p2, p3]
    }
  }

  // -----------------------------------------------------------------------
  // Animation frame
  // -----------------------------------------------------------------------

  private frame = (timestamp: number) => {
    const dt = Math.min((timestamp - this.lastFrame) / 1000, 0.1)
    this.lastFrame = timestamp

    const ctx = this.ctx
    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)

    if (this.data) {
      this.drawPipes(ctx, dt)
      this.drawSectionLabels(ctx)
      this.drawNodes(ctx)
      this.drawCenterNode(ctx)
    } else {
      this.drawEmptyState(ctx)
    }

    ctx.restore()
    this.animId = requestAnimationFrame(this.frame)
  }

  // -----------------------------------------------------------------------
  // Drawing: Pipes & Particles
  // -----------------------------------------------------------------------

  private drawPipes(ctx: CanvasRenderingContext2D, dt: number): void {
    const allPipes = [...this.downloadPipes, ...this.uploadPipes]
    const running = this.data?.running ?? false

    for (const pipe of allPipes) {
      const [p0, p1, p2, p3] = this.pipeControlPoints(pipe)
      const fraction = pipe.throughputFraction
      const lineW = Math.max(2, Math.min(16, fraction * 16))
      const alpha = running ? 0.4 : 0.15

      // Draw pipe stroke
      ctx.beginPath()
      ctx.moveTo(p0.x, p0.y)
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
      ctx.strokeStyle = hexToRgba(pipe.color, alpha)
      ctx.lineWidth = lineW
      ctx.lineCap = 'round'
      ctx.stroke()

      // Particles
      if (running) {
        // Spawn new particles
        const spawnRate = 2 + fraction * 13 // 2..15 per second
        pipe.spawnAccum += spawnRate * dt
        while (pipe.spawnAccum >= 1) {
          pipe.spawnAccum -= 1
          pipe.particles.push({
            t: 0,
            speed: 0.3 + fraction * 0.7,
          })
        }

        // Cap particles to avoid runaway
        if (pipe.particles.length > 60) {
          pipe.particles.splice(0, pipe.particles.length - 60)
        }

        // Update & draw particles
        ctx.save()
        ctx.shadowBlur = 6
        ctx.shadowColor = pipe.color
        ctx.fillStyle = pipe.color

        for (let i = pipe.particles.length - 1; i >= 0; i--) {
          const particle = pipe.particles[i]
          particle.t += particle.speed * dt
          if (particle.t >= 1) {
            particle.t -= 1 // recycle
          }
          const pos = bezierPoint(p0, p1, p2, p3, particle.t)
          ctx.beginPath()
          ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.restore()
      }
    }
  }

  // -----------------------------------------------------------------------
  // Drawing: Side nodes
  // -----------------------------------------------------------------------

  private drawNodes(ctx: CanvasRenderingContext2D): void {
    for (const node of [...this.downloadNodes, ...this.uploadNodes]) {
      this.drawSideNode(ctx, node)
    }
  }

  private drawSideNode(ctx: CanvasRenderingContext2D, node: NodeRect): void {
    // Background
    roundedRect(ctx, node.x, node.y, node.w, node.h, 8)
    ctx.fillStyle = COLORS.nodeBg
    ctx.fill()

    // Border
    roundedRect(ctx, node.x, node.y, node.w, node.h, 8)
    ctx.strokeStyle = hexToRgba(node.color, 0.6)
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Name
    ctx.fillStyle = COLORS.textPrimary
    ctx.font = 'bold 12px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(node.name, node.x + node.w / 2, node.y + node.h * 0.35, node.w - 12)

    // Detail
    ctx.fillStyle = COLORS.textSecondary
    ctx.font = '10px system-ui, -apple-system, sans-serif'
    ctx.fillText(node.detail, node.x + node.w / 2, node.y + node.h * 0.7, node.w - 12)
  }

  // -----------------------------------------------------------------------
  // Drawing: Center node
  // -----------------------------------------------------------------------

  private drawCenterNode(ctx: CanvasRenderingContext2D): void {
    const n = this.centerNode
    const data = this.data
    if (!data) return

    // Background
    roundedRect(ctx, n.x, n.y, n.w, n.h, 12)
    ctx.fillStyle = COLORS.nodeBg
    ctx.fill()

    // Gradient border (cyan left, violet right)
    ctx.save()
    roundedRect(ctx, n.x, n.y, n.w, n.h, 12)
    const grad = ctx.createLinearGradient(n.x, n.y, n.x + n.w, n.y)
    grad.addColorStop(0, hexToRgba(COLORS.downloadAccent, 0.7))
    grad.addColorStop(1, hexToRgba(COLORS.uploadAccent, 0.7))
    ctx.strokeStyle = grad
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()

    // Text content - stacked vertically
    const cx = n.x + n.w / 2
    let ty = n.y + 22

    // "Your Machine"
    ctx.fillStyle = COLORS.textPrimary
    ctx.font = 'bold 14px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Your Machine', cx, ty)
    ty += 24

    // Download speed
    ctx.fillStyle = COLORS.downloadAccent
    ctx.font = 'bold 20px system-ui, -apple-system, sans-serif'
    ctx.fillText('\u2193 ' + formatSpeed(data.totalDownloadBps), cx, ty)
    ty += 24

    // Upload speed
    ctx.fillStyle = COLORS.uploadAccent
    ctx.font = 'bold 20px system-ui, -apple-system, sans-serif'
    ctx.fillText('\u2191 ' + formatSpeed(data.totalUploadBps), cx, ty)
    ty += 22

    // Streams
    ctx.fillStyle = COLORS.textSecondary
    ctx.font = '11px system-ui, -apple-system, sans-serif'
    ctx.fillText(`\u2193 ${data.downloadStreams} streams  \u2191 ${data.uploadStreams} streams`, cx, ty)
    ty += 18

    // Uptime
    ctx.fillStyle = COLORS.textDim
    ctx.font = '10px system-ui, -apple-system, sans-serif'
    ctx.fillText(`Uptime: ${formatDuration(data.uptimeSeconds)}`, cx, ty)
    ty += 16

    // Session bytes
    ctx.fillText(
      `\u2193 ${formatBytes(data.sessionDownloadBytes)}  \u2191 ${formatBytes(data.sessionUploadBytes)}`,
      cx,
      ty,
    )
    ty += 16

    // Server health
    const allHealthy = data.healthyServers === data.totalServers
    ctx.fillStyle = data.totalServers === 0 ? COLORS.textDim : allHealthy ? COLORS.healthy : COLORS.warning
    ctx.fillText(`${data.healthyServers}/${data.totalServers} servers`, cx, ty)
  }

  // -----------------------------------------------------------------------
  // Drawing: Section labels
  // -----------------------------------------------------------------------

  private drawSectionLabels(ctx: CanvasRenderingContext2D): void {
    if (this.isMobile) return

    ctx.fillStyle = COLORS.textDim
    ctx.font = 'bold 10px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // "DOWNLOAD" above left column
    if (this.downloadNodes.length > 0) {
      const firstNode = this.downloadNodes[0]
      ctx.fillText('D O W N L O A D', firstNode.x + firstNode.w / 2, firstNode.y - 12)
    }

    // "UPLOAD" above right column
    if (this.uploadNodes.length > 0) {
      const firstNode = this.uploadNodes[0]
      ctx.fillText('U P L O A D', firstNode.x + firstNode.w / 2, firstNode.y - 12)
    }
  }

  // -----------------------------------------------------------------------
  // Drawing: Empty state
  // -----------------------------------------------------------------------

  private drawEmptyState(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = COLORS.textDim
    ctx.font = '14px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Waiting for data\u2026', this.width / 2, this.height / 2)
  }
}
