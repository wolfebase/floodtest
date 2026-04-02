import { useEffect, useRef, useState } from 'react'
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
  const [serverDataVersion, setServerDataVersion] = useState(0)

  // Initialize renderer once
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    rendererRef.current = new TrafficFlowRenderer(canvas)
    rendererRef.current.start()
    return () => { rendererRef.current?.stop() }
  }, [])

  // Handle container resize via ResizeObserver, with dynamic height based on provider count
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const computeHeight = (): number => {
      const { dl, ul } = serverDataRef.current
      const dlActive = dl.filter(s => s.activeStreams > 0)
      const ulActive = ul.filter(s => s.activeStreams > 0)
      // Estimate provider count by grouping hostnames
      const extractDomain = (url: string) => {
        try { return new URL(url).hostname.split('.').slice(-2).join('.') } catch { return url }
      }
      const dlProviders = new Set(dlActive.map(s => extractDomain(s.url)))
      const ulProviders = new Set(ulActive.map(s => extractDomain(s.url)))
      const maxNodes = Math.max(dlProviders.size, ulProviders.size, 1)
      return window.innerWidth < 640 ? 400 : Math.max(300, maxNodes * 58 + 80)
    }

    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect
      rendererRef.current?.resize(width, computeHeight())
    })
    observer.observe(container)
    return () => observer.disconnect()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDataVersion])

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
        setServerDataVersion(v => v + 1)
      } catch { /* ignore */ }
    }
    fetchServers()
    const interval = setInterval(fetchServers, 5000)
    return () => clearInterval(interval)
  }, [])

  // Push data to renderer on every WebSocket tick (no React re-render of canvas)
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
