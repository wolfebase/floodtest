import { useState, useEffect } from 'react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { WsStats } from '../hooks/useWebSocket'
import { api, UsageCounters, HistoryPoint } from '../api/client'
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

function formatSpeed(bps: number): string {
  const gbps = bps / 1_000_000_000
  if (gbps >= 1) return `${gbps.toFixed(2)} Gbps`
  return `${(bps / 1_000_000).toFixed(0)} Mbps`
}

export default function Dashboard({ ws }: DashboardProps) {
  const { stats, connected } = ws
  const [usage, setUsage] = useState<UsageCounters | null>(null)
  const [recentHistory, setRecentHistory] = useState<HistoryPoint[]>([])

  useEffect(() => {
    const fetchUsage = () => { api.getUsage().then(setUsage).catch(() => {}) }
    fetchUsage()
    const interval = setInterval(fetchUsage, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    api.getHistory('24h').then(data => setRecentHistory(data)).catch(() => {})
  }, [])

  const avgDownload = recentHistory.length > 0
    ? recentHistory.reduce((s, p) => s + p.downloadBps, 0) / recentHistory.length
    : 0

  return (
    <div className="space-y-4">
      {/* Compact status indicators */}
      <div className="flex items-center justify-end gap-4">
        {stats.totalServers > 0 && (
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${
              stats.healthyServers === stats.totalServers ? 'bg-emerald-500'
              : stats.healthyServers < stats.totalServers * 0.5 ? 'bg-red-500'
              : 'bg-yellow-500'
            }`} />
            <span className="text-xs text-zinc-500 font-mono">
              {stats.healthyServers}/{stats.totalServers} servers
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          <span className="text-xs text-zinc-500">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

      {/* Control Surface */}
      <ControlSurface stats={stats} />

      {/* Traffic Flow - only when running */}
      {stats.running && <TrafficFlow stats={stats} />}

      {/* 24h sparkline - only when idle and has data */}
      {!stats.running && recentHistory.length > 0 && (
        <div className="bg-forge-surface rounded-lg border border-forge-border p-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Last 24h</span>
            <span className="text-xs font-mono text-zinc-500">
              avg &darr;{formatSpeed(avgDownload)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={recentHistory}>
              <defs>
                <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="downloadBps"
                stroke="#f59e0b"
                fill="url(#sparkGradient)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Usage Stats */}
      {usage && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Session', dl: usage.session.downloadBytes, ul: usage.session.uploadBytes },
            { label: 'Today', dl: usage.today.downloadBytes, ul: usage.today.uploadBytes },
            { label: 'This Month', dl: usage.month.downloadBytes, ul: usage.month.uploadBytes },
            { label: 'All Time', dl: usage.allTime.downloadBytes, ul: usage.allTime.uploadBytes },
          ].map(u => (
            <div key={u.label} className="bg-forge-surface rounded-lg border border-forge-border p-3">
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">{u.label}</h3>
              <div className="text-sm font-mono text-zinc-300">&darr; {formatBytes(u.dl)}</div>
              <div className="text-sm font-mono text-zinc-300">&uarr; {formatBytes(u.ul)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
