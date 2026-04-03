import { useState, useEffect } from 'react'
import { Zap } from 'lucide-react'
import { WsStats } from '../hooks/useWebSocket'
import { api } from '../api/client'
import { groupDownloadServers } from '../utils/providerGrouping'
import ModeToggle from './ModeToggle'
import ThroughputColumn from './ThroughputColumn'
import ServerPoolColumn from './ServerPoolColumn'
import EngineLog from './EngineLog'

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

export default function ControlSurface({ stats }: ControlSurfaceProps) {
  const [mode, setMode] = useState<string>('reliable')
  const [toggling, setToggling] = useState(false)
  const [providerCount, setProviderCount] = useState(0)

  useEffect(() => {
    if (stats.autoMode) setMode(stats.autoMode)
  }, [stats.autoMode])

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const servers = await api.getServerHealth()
        const groups = groupDownloadServers(servers)
        setProviderCount(groups.length)
      } catch { /* ignore */ }
    }
    fetchProviders()
    const interval = setInterval(fetchProviders, 5000)
    return () => clearInterval(interval)
  }, [])

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
      <div className="bg-forge-surface rounded-lg border border-forge-border p-4 shadow-lg shadow-amber-500/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-zinc-50">READY</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 font-mono">
              {stats.healthyServers}/{stats.totalServers} healthy
            </span>
            <ModeToggle mode={mode} onChange={handleModeChange} compact />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 text-xs">ISP</span>
            <span className="font-mono text-zinc-200 text-sm">
              &darr;{formatSpeed(stats.measuredDownloadMbps * 1e6)} / &uarr;{formatSpeed(stats.measuredUploadMbps * 1e6)}
            </span>
          </div>
          {stats.nextScheduledTime && (
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 text-xs">Next</span>
              <span className="text-zinc-400 text-xs">{stats.nextScheduledEvent}</span>
            </div>
          )}
        </div>

        {/* ISP test progress bar if running */}
        {stats.ispTestRunning && (
          <div className="mb-3">
            <div className="h-1 bg-forge-raised rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${stats.ispTestProgress}%` }} />
            </div>
            <span className="text-xs text-zinc-500 mt-1 block">{stats.ispTestPhase}... {stats.ispTestProgress}%</span>
          </div>
        )}

        <button
          onClick={handleToggle}
          disabled={toggling}
          className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold text-base transition-colors disabled:opacity-50"
        >
          Launch
        </button>
      </div>
    )
  }

  // --- RUNNING STATE ---
  return (
    <div className="bg-forge-surface rounded-lg border border-forge-border transition-all duration-300">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-forge-border">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-semibold text-zinc-50 capitalize">{mode}</span>
          <span className="text-sm text-zinc-500">&middot;</span>
          <span className="text-sm text-zinc-400 tabular-nums font-mono">{formatDuration(stats.uptimeSeconds)}</span>
        </div>
        <div className="flex items-center gap-3">
          <ModeToggle mode={mode} onChange={handleModeChange} compact />
          <button
            onClick={handleToggle}
            disabled={toggling}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-red-600/20 text-red-400 border border-red-800 hover:bg-red-600/30 transition-colors disabled:opacity-50"
          >
            {toggling ? '...' : 'Stop'}
          </button>
        </div>
      </div>

      {stats.ispTestRunning && (
        <div className="px-5 py-2 border-b border-forge-border space-y-1">
          <p className="text-xs text-amber-400">{stats.ispTestPhase || 'Running speed test...'}</p>
          <div className="h-1 bg-forge-raised rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-300"
              style={{ width: `${stats.ispTestProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Three-column command grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 md:divide-x divide-forge-border">
        <div className="p-5">
          <ThroughputColumn stats={stats} mode={mode} />
        </div>
        <div className="p-5 border-t md:border-t-0 border-forge-border">
          <ServerPoolColumn stats={stats} providerCount={providerCount} />
        </div>
        <div className="p-5 border-t md:border-t-0 border-forge-border">
          <EngineLog events={stats.events || []} />
        </div>
      </div>
    </div>
  )
}
