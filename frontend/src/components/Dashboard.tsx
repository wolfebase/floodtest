import { useState, useEffect } from 'react'
import { WsStats } from '../hooks/useWebSocket'
import { api, UsageCounters } from '../api/client'
import TrafficFlow from './TrafficFlow'
import ControlSurface from './ControlSurface'

interface DashboardProps {
  ws: { stats: WsStats; connected: boolean }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${(bytes / 1e6).toFixed(2)} MB`
}

export default function Dashboard({ ws }: DashboardProps) {
  const { stats, connected } = ws
  const [usage, setUsage] = useState<UsageCounters | null>(null)

  useEffect(() => {
    const fetchUsage = () => { api.getUsage().then(setUsage).catch(() => {}) }
    fetchUsage()
    const interval = setInterval(fetchUsage, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">FloodTest Dashboard</h2>
        <div className="flex items-center gap-4">
          {stats.totalServers > 0 && (
            <div className="flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${
                stats.healthyServers === stats.totalServers ? 'bg-green-500'
                : stats.healthyServers < stats.totalServers * 0.5 ? 'bg-red-500'
                : 'bg-yellow-500'
              }`} />
              <span className="text-sm text-gray-400">
                {stats.healthyServers}/{stats.totalServers} servers
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-400">{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </div>

      {/* Control Surface */}
      <ControlSurface stats={stats} />

      {/* Traffic Flow */}
      <TrafficFlow stats={stats} />

      {/* Usage Stats */}
      {usage && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Session', dl: usage.session.downloadBytes, ul: usage.session.uploadBytes },
            { label: 'Today', dl: usage.today.downloadBytes, ul: usage.today.uploadBytes },
            { label: 'This Month', dl: usage.month.downloadBytes, ul: usage.month.uploadBytes },
            { label: 'All Time', dl: usage.allTime.downloadBytes, ul: usage.allTime.uploadBytes },
          ].map(u => (
            <div key={u.label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{u.label}</h3>
              <div className="text-sm text-gray-300">&darr; {formatBytes(u.dl)}</div>
              <div className="text-sm text-gray-300">&uarr; {formatBytes(u.ul)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
