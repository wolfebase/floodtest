import { useState, useEffect } from 'react'
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

  const hasMeasurements = stats.measuredDownloadMbps > 0

  // --- IDLE STATE ---
  if (!stats.running) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 max-w-lg mx-auto text-center space-y-5 transition-all duration-300">
        <ModeToggle mode={mode} onChange={handleModeChange} />

        <div className="space-y-2">
          {mode === 'reliable' ? (
            <>
              <p className="text-sm text-gray-400">
                Auto-tuned for sustained throughput. Measures your line, targets 90% of capacity.
              </p>
              {hasMeasurements ? (
                <p className="text-xs text-gray-500">
                  Last measured: {Math.round(stats.measuredDownloadMbps)} / {Math.round(stats.measuredUploadMbps)} Mbps
                </p>
              ) : (
                <p className="text-xs text-gray-500">Will run speed test on start</p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400">
                No rate limits. Maximum parallel streams push your hardware to the edge.
              </p>
              <p className="text-xs text-gray-500">64 download · 32 upload streams</p>
            </>
          )}
        </div>

        {stats.ispTestRunning && (
          <div className="space-y-2">
            <p className="text-sm text-blue-400">{stats.ispTestPhase || 'Running speed test...'}</p>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${stats.ispTestProgress}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleToggle}
          disabled={toggling}
          className="px-8 py-3 rounded-lg font-semibold text-base bg-green-600 hover:bg-green-500 text-white transition-colors disabled:opacity-50"
        >
          {toggling ? '...' : 'Launch'}
        </button>
      </div>
    )
  }

  // --- RUNNING STATE ---
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 transition-all duration-300">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-semibold text-white capitalize">{mode}</span>
          <span className="text-sm text-gray-500">&middot;</span>
          <span className="text-sm text-gray-400 tabular-nums">{formatDuration(stats.uptimeSeconds)}</span>
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
        <div className="px-5 py-2 border-b border-gray-800 space-y-1">
          <p className="text-xs text-blue-400">{stats.ispTestPhase || 'Running speed test...'}</p>
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${stats.ispTestProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Three-column command grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-0 md:divide-x divide-gray-800">
        <div className="p-5">
          <ThroughputColumn stats={stats} mode={mode} />
        </div>
        <div className="p-5 border-t md:border-t-0 border-gray-800">
          <ServerPoolColumn stats={stats} providerCount={providerCount} />
        </div>
        <div className="p-5 border-t md:border-t-0 border-gray-800">
          <EngineLog events={stats.events || []} />
        </div>
      </div>
    </div>
  )
}
