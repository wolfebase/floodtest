import { useState, useEffect, useRef } from 'react'
import { Zap, Power, Flame } from 'lucide-react'
import { WsStats } from '../hooks/useWebSocket'
import { api } from '../api/client'
import { groupDownloadServers, ProviderGroup } from '../utils/providerGrouping'
import ModeToggle from './ModeToggle'
import ThroughputColumn from './ThroughputColumn'
import ServerPoolColumn from './ServerPoolColumn'
import SessionMetrics from './SessionMetrics'

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

function formatSpeed(bps: number): string {
  const gbps = bps / 1_000_000_000
  if (gbps >= 1) return `${gbps.toFixed(2)} Gbps`
  return `${(bps / 1_000_000).toFixed(0)} Mbps`
}

const MAX_SPARKLINE = 60

export default function ControlSurface({ stats }: ControlSurfaceProps) {
  const [mode, setMode] = useState<string>('reliable')
  const [toggling, setToggling] = useState(false)
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([])
  const [sparkline, setSparkline] = useState<number[]>([])
  const lastBpsRef = useRef<number>(0)

  useEffect(() => {
    if (stats.autoMode) setMode(stats.autoMode)
  }, [stats.autoMode])

  // Fetch provider groups (not just count)
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const servers = await api.getServerHealth()
        const groups = groupDownloadServers(servers)
        setProviderGroups(groups)
      } catch { /* ignore */ }
    }
    fetchProviders()
    const interval = setInterval(fetchProviders, 5000)
    return () => clearInterval(interval)
  }, [])

  // Build sparkline history from WS ticks
  useEffect(() => {
    if (!stats.running) {
      if (sparkline.length > 0) setSparkline([])
      return
    }
    // Only push if the value actually changed (avoid duplicate pushes from re-renders)
    const bps = stats.downloadBps
    if (bps !== lastBpsRef.current) {
      lastBpsRef.current = bps
      setSparkline(prev => {
        const next = [...prev, bps]
        return next.length > MAX_SPARKLINE ? next.slice(-MAX_SPARKLINE) : next
      })
    }
  }, [stats.downloadBps, stats.running])

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
    } catch { /* ignore */ } finally {
      setToggling(false)
    }
  }

  // --- IDLE STATE ---
  if (!stats.running) {
    return (
      <div className="gradient-border glow-amber">
        <div className="gradient-border-inner p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Zap size={20} className="text-amber-400" />
                </div>
                <div className="absolute inset-0 rounded-xl bg-amber-500/20 blur-lg animate-breathe" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-zinc-100">Ready to Launch</span>
                  <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Standby
                  </span>
                </div>
                <span className="text-xs text-zinc-500 font-mono">
                  {stats.healthyServers}/{stats.totalServers} servers online
                </span>
              </div>
            </div>
            <ModeToggle mode={mode} onChange={handleModeChange} />
          </div>

          {/* ISP speed + schedule */}
          <div className="flex items-center gap-6 mb-4 px-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">ISP Speed</span>
              <span className="font-mono text-sm text-zinc-300">
                ↓{formatSpeed(stats.measuredDownloadMbps * 1e6)} / ↑{formatSpeed(stats.measuredUploadMbps * 1e6)}
              </span>
            </div>
            {stats.nextScheduledTime && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Next</span>
                <span className="text-xs text-zinc-400">{stats.nextScheduledEvent}</span>
              </div>
            )}
          </div>

          {/* ISP test progress bar if running */}
          {stats.ispTestRunning && (
            <div className="mb-4">
              <div className="relative h-1.5 bg-forge-raised rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-300 progress-shimmer"
                  style={{ width: `${stats.ispTestProgress}%` }}
                />
              </div>
              <span className="text-xs text-zinc-500 mt-1.5 block">{stats.ispTestPhase}... {stats.ispTestProgress}%</span>
            </div>
          )}

          {/* Launch button */}
          <button
            onClick={handleToggle}
            disabled={toggling}
            aria-label="Launch Engine"
            className="group relative w-full py-4 rounded-xl font-bold text-base transition-all duration-300 disabled:opacity-50 overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-amber-600 via-orange-500 to-red-500 transition-opacity duration-300" />
            <div className="absolute inset-0 bg-gradient-to-r from-amber-500 via-orange-400 to-red-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
            <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 to-red-500 rounded-xl blur-lg opacity-30 group-hover:opacity-50 transition-opacity duration-300" />
            <div className="relative flex items-center justify-center gap-2 text-white">
              <Flame size={20} strokeWidth={2.5} className="group-hover:animate-float" />
              <span className="tracking-wide">Launch Engine</span>
            </div>
          </button>
        </div>
      </div>
    )
  }

  // --- RUNNING STATE ---
  return (
    <div className="relative bg-forge-surface rounded-xl border border-emerald-500/20 overflow-hidden transition-all duration-300 glow-amber">
      {/* Subtle animated top border */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500 via-amber-500 to-emerald-500 animate-border-flow" style={{ backgroundSize: '200% 100%' }} />

      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-40" />
          </div>
          <span className="text-sm font-bold text-zinc-100 capitalize">{mode}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-sm text-zinc-400 tabular-nums font-mono">{formatDuration(stats.uptimeSeconds)}</span>
        </div>
        <div className="flex items-center gap-3">
          <ModeToggle mode={mode} onChange={handleModeChange} compact />
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="group flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/30 transition-all duration-200 disabled:opacity-50"
          >
            <Power size={14} />
            <span>{toggling ? '...' : 'Stop'}</span>
          </button>
        </div>
      </div>

      {stats.ispTestRunning && (
        <div className="px-5 py-2.5 border-b border-white/[0.06] space-y-1.5">
          <p className="text-xs font-medium text-amber-400">{stats.ispTestPhase || 'Running speed test...'}</p>
          <div className="relative h-1.5 bg-forge-raised rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-300 progress-shimmer"
              style={{ width: `${stats.ispTestProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Three-column command grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 md:divide-x divide-white/[0.06]">
        <div className="p-5">
          <ThroughputColumn stats={stats} mode={mode} sparkline={sparkline} />
        </div>
        <div className="p-5 border-t md:border-t-0 border-white/[0.06]">
          <ServerPoolColumn stats={stats} providerGroups={providerGroups} />
        </div>
        <div className="p-5 border-t md:border-t-0 border-white/[0.06]">
          <SessionMetrics stats={stats} events={stats.events || []} />
        </div>
      </div>
    </div>
  )
}
