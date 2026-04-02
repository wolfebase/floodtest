import { useEffect, useRef } from 'react'
import { WsStats } from '../hooks/useWebSocket'
import { usePageVisibility } from '../hooks/usePageVisibility'
import { api, ServerHealth, UploadServerHealth } from '../api/client'
import { groupDownloadServers, groupUploadServers } from '../utils/providerGrouping'
import { TrafficFlowRenderer, FlowData } from '../utils/trafficFlowRenderer'

interface Props {
  stats: WsStats
}

function estimateProviderCount(servers: (ServerHealth | UploadServerHealth)[]): number {
  const active = servers.filter(s => s.activeStreams > 0)
  const domains = new Set(active.map(s => {
    try { return new URL(s.url).hostname.split('.').slice(-2).join('.') } catch { return s.url }
  }))
  return domains.size
}

export default function TrafficFlow({ stats }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<TrafficFlowRenderer | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const visible = usePageVisibility()
  const serverDataRef = useRef<{ dl: ServerHealth[]; ul: UploadServerHealth[] }>({ dl: [], ul: [] })
  const lastWidthRef = useRef(0)
  const lastHeightRef = useRef(0)

  // Initialize renderer once
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    rendererRef.current = new TrafficFlowRenderer(canvas)
    rendererRef.current.start()
    return () => { rendererRef.current?.stop() }
  }, [])

  // Handle container resize via ResizeObserver (only triggers resize on actual size changes)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect
      if (width > 0 && width !== lastWidthRef.current) {
        lastWidthRef.current = width
        const { dl, ul } = serverDataRef.current
        const maxNodes = Math.max(estimateProviderCount(dl), estimateProviderCount(ul), 1)
        const height = window.innerWidth < 640 ? 400 : Math.max(300, maxNodes * 58 + 80)
        lastHeightRef.current = height
        rendererRef.current?.resize(width, height)
      }
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

  // Poll server health every 5 seconds for provider grouping
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const [dl, ul] = await Promise.all([
          api.getServerHealth(),
          api.getUploadServerHealth(),
        ])
        serverDataRef.current = { dl, ul }

        // Only resize if height needs to change (provider count changed)
        const maxNodes = Math.max(estimateProviderCount(dl), estimateProviderCount(ul), 1)
        const newHeight = window.innerWidth < 640 ? 400 : Math.max(300, maxNodes * 58 + 80)
        if (newHeight !== lastHeightRef.current && lastWidthRef.current > 0) {
          lastHeightRef.current = newHeight
          rendererRef.current?.resize(lastWidthRef.current, newHeight)
        }
      } catch { /* ignore */ }
    }
    fetchServers()
    const interval = setInterval(fetchServers, 5000)
    return () => clearInterval(interval)
  }, [])

  // Push data to renderer on every WebSocket tick
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
      <canvas ref={canvasRef} className="w-full block" />
    </div>
  )
}
