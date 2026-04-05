import { useState, useEffect } from 'react'
import { AreaChart, Area, BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import {
  Activity, ArrowDownCircle, ArrowUpCircle, Calendar, Clock, TrendingUp,
  Zap, Shield, AlertTriangle, CheckCircle, Globe, Server, RefreshCw,
  BarChart3, Wifi, Timer, Flame, ChevronRight, ArrowUp, ArrowDown,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { WsStats } from '../hooks/useWebSocket'
import {
  api, UsageCounters, HistoryPoint, ThrottleEvent, Schedule,
  ServerHealth, SpeedTestHistoryEntry, DailyUsageEntry, UpdateStatus,
} from '../api/client'
import { extractProvider } from '../utils/providerGrouping'
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

function formatSpeedMbps(mbps: number): string {
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`
  return `${mbps.toFixed(0)} Mbps`
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function shortTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

const usageConfig = [
  { label: 'Session', icon: Activity, accent: 'from-cyan-500/20 to-cyan-600/5', iconColor: 'text-cyan-400', borderColor: 'border-cyan-500/20' },
  { label: 'Today', icon: Clock, accent: 'from-amber-500/20 to-amber-600/5', iconColor: 'text-amber-400', borderColor: 'border-amber-500/20' },
  { label: 'This Month', icon: Calendar, accent: 'from-rose-500/15 to-rose-600/5', iconColor: 'text-rose-400', borderColor: 'border-rose-500/20' },
  { label: 'All Time', icon: TrendingUp, accent: 'from-violet-500/15 to-violet-600/5', iconColor: 'text-violet-400', borderColor: 'border-violet-500/20' },
]

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const glassTooltipStyle = { background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', fontSize: '12px' }

export default function Dashboard({ ws }: DashboardProps) {
  const { stats, connected } = ws
  const [usage, setUsage] = useState<UsageCounters | null>(null)
  const [recentHistory, setRecentHistory] = useState<HistoryPoint[]>([])
  const [throttleEvents, setThrottleEvents] = useState<ThrottleEvent[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [serverHealth, setServerHealth] = useState<ServerHealth[]>([])
  const [speedTestHistory, setSpeedTestHistory] = useState<SpeedTestHistoryEntry[]>([])
  const [dailyUsage, setDailyUsage] = useState<DailyUsageEntry[]>([])
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  // Fetch all dashboard data
  useEffect(() => {
    const fetchAll = () => {
      api.getUsage().then(setUsage).catch(() => {})
      api.getThrottleEvents().then(setThrottleEvents).catch(() => {})
      api.getServerHealth().then(setServerHealth).catch(() => {})
    }
    fetchAll()
    const interval = setInterval(fetchAll, 10000)
    return () => clearInterval(interval)
  }, [])

  // One-time fetches for slower-changing data
  useEffect(() => {
    api.getHistory('24h').then(setRecentHistory).catch(() => {})
    api.getSchedules().then(setSchedules).catch(() => {})
    api.getSpeedtestHistory().then(setSpeedTestHistory).catch(() => {})
    api.getDailyUsage(7).then(setDailyUsage).catch(() => {})
    api.getUpdateStatus().then(setUpdateStatus).catch(() => {})
  }, [])

  const avgDownload = recentHistory.length > 0
    ? recentHistory.reduce((s, p) => s + p.downloadBps, 0) / recentHistory.length
    : 0

  const usageData = usage ? [
    { dl: usage.session.downloadBytes, ul: usage.session.uploadBytes },
    { dl: usage.today.downloadBytes, ul: usage.today.uploadBytes },
    { dl: usage.month.downloadBytes, ul: usage.month.uploadBytes },
    { dl: usage.allTime.downloadBytes, ul: usage.allTime.uploadBytes },
  ] : null

  // Derived data for new panels
  const activeThrottles = throttleEvents.filter(e => !e.resolvedAt)
  const recentThrottles = throttleEvents.slice(0, 5)

  const providerStats = (() => {
    const groups = new Map<string, { name: string; servers: number; healthy: number; totalBytes: number; avgSpeed: number; speeds: number[] }>()
    for (const s of serverHealth) {
      const name = extractProvider(s.url)
      const g = groups.get(name) || { name, servers: 0, healthy: 0, totalBytes: 0, avgSpeed: 0, speeds: [] }
      g.servers++
      if (s.healthy) g.healthy++
      g.totalBytes += s.bytesDownloaded
      if (s.speedBps > 0) g.speeds.push(s.speedBps)
      groups.set(name, g)
    }
    return [...groups.values()]
      .map(g => ({ ...g, avgSpeed: g.speeds.length > 0 ? g.speeds.reduce((a, b) => a + b, 0) / g.speeds.length : 0 }))
      .sort((a, b) => b.totalBytes - a.totalBytes)
      .slice(0, 6)
  })()

  const totalFailures = serverHealth.reduce((s, h) => s + h.totalFailures, 0)
  const totalDownloads = serverHealth.reduce((s, h) => s + h.totalDownloads, 0)
  const blockedCount = serverHealth.filter(s => s.blocked).length
  const successRate = totalDownloads > 0 ? Math.round(((totalDownloads - totalFailures) / totalDownloads) * 100) : 100

  const enabledSchedules = schedules.filter(s => s.enabled)

  const dailyChartData = dailyUsage.map(d => ({
    date: shortDate(d.date + 'T00:00:00'),
    dl: d.downloadBytes / 1e9,
    ul: d.uploadBytes / 1e9,
  }))

  const speedChartData = speedTestHistory.slice(0, 20).reverse().map(s => ({
    time: shortTime(s.timestamp),
    download: s.downloadMbps,
    upload: s.uploadMbps,
  }))

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Header row */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"
      >
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-0.5 hidden sm:block">Real-time throughput monitoring</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {stats.totalServers > 0 && (
            <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-forge-surface border border-forge-border">
              <div className={`w-2 h-2 rounded-full ${
                stats.healthyServers === stats.totalServers ? 'bg-emerald-500'
                : stats.healthyServers < stats.totalServers * 0.5 ? 'bg-red-500'
                : 'bg-yellow-500'
              } ${stats.healthyServers === stats.totalServers ? 'animate-pulse' : ''}`} />
              <span className="text-[10px] sm:text-xs text-zinc-400 font-mono">
                {stats.healthyServers}/{stats.totalServers}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full bg-forge-surface border border-forge-border">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-[10px] sm:text-xs text-zinc-400">{connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </motion.div>

      {/* Control Surface */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06, duration: 0.4 }}>
        <ControlSurface stats={stats} />
      </motion.div>

      {/* Traffic Flow - only when running */}
      {stats.running && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.4 }}>
          <TrafficFlow stats={stats} />
        </motion.div>
      )}

      {/* 24h sparkline - only when idle and has data */}
      {!stats.running && recentHistory.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.4 }}
        >
          <div className="glass-card p-4 card-hover">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <TrendingUp size={14} className="text-cyan-400" />
                </div>
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Last 24 Hours</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-forge-raised">
                <ArrowDownCircle size={12} className="text-cyan-400" />
                <span className="text-xs font-mono text-zinc-300">avg {formatSpeed(avgDownload)}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={64}>
              <AreaChart data={recentHistory}>
                <defs>
                  <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="50%" stopColor="#06b6d4" stopOpacity={0.1} />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="downloadBps" stroke="#06b6d4" fill="url(#sparkGradient)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* Usage Stats */}
      {usageData && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {usageConfig.map((cfg, i) => {
            const Icon = cfg.icon
            const data = usageData[i]
            return (
              <motion.div
                key={cfg.label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: (i + 3) * 0.06, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              >
                <div
                  className={`group relative glass-card ${cfg.borderColor} overflow-hidden card-hover`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${cfg.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                  <div className="relative p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-lg bg-white/[0.04] flex items-center justify-center ${cfg.iconColor}`}>
                          <Icon size={14} />
                        </div>
                        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{cfg.label}</h3>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <ArrowDownCircle size={13} className="text-cyan-400 flex-shrink-0" />
                        <span className="text-sm font-bold font-mono text-zinc-200 tabular-nums">{formatBytes(data.dl)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ArrowUpCircle size={13} className="text-amber-400 flex-shrink-0" />
                        <span className="text-sm font-bold font-mono text-zinc-300 tabular-nums">{formatBytes(data.ul)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* ================================================================ */}
      {/* DATA PANELS - 2-column grid                                     */}
      {/* ================================================================ */}

      {/* Row 1: Peak Performance + Throttle Monitor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Peak Performance */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className="glass-card card-hover overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                  <Flame size={14} className="text-cyan-400" />
                </div>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Peak Performance</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">Peak Download</div>
                  <div className="flex items-center gap-1.5">
                    <ArrowDown size={14} className="text-cyan-400" />
                    <span className="text-lg font-bold font-mono text-cyan-400 tabular-nums">
                      {formatSpeed(stats.peakDownloadBps ?? 0)}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">Peak Upload</div>
                  <div className="flex items-center gap-1.5">
                    <ArrowUp size={14} className="text-amber-400" />
                    <span className="text-lg font-bold font-mono text-amber-400 tabular-nums">
                      {formatSpeed(stats.peakUploadBps ?? 0)}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">ISP Download</div>
                  <div className="flex items-center gap-1.5">
                    <Wifi size={14} className="text-cyan-400" />
                    <span className="text-sm font-bold font-mono text-zinc-300 tabular-nums">
                      {stats.measuredDownloadMbps > 0 ? formatSpeedMbps(stats.measuredDownloadMbps) : '—'}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">ISP Upload</div>
                  <div className="flex items-center gap-1.5">
                    <Wifi size={14} className="text-cyan-400" />
                    <span className="text-sm font-bold font-mono text-zinc-300 tabular-nums">
                      {stats.measuredUploadMbps > 0 ? formatSpeedMbps(stats.measuredUploadMbps) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Throttle Monitor */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className={`glass-card overflow-hidden ${
            activeThrottles.length > 0 ? 'border-red-500/30' : ''
          }`}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    activeThrottles.length > 0 ? 'bg-red-500/10' : 'bg-emerald-500/10'
                  }`}>
                    {activeThrottles.length > 0
                      ? <AlertTriangle size={14} className="text-red-400" />
                      : <Shield size={14} className="text-emerald-400" />}
                  </div>
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Throttle Monitor</h3>
                </div>
                {activeThrottles.length > 0 ? (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-red-500/15 text-red-400 border border-red-500/20 animate-pulse">
                    {activeThrottles.length} Active
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                    Clear
                  </span>
                )}
              </div>
              {recentThrottles.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500 py-2">
                  <CheckCircle size={14} className="text-emerald-500" />
                  <span>No throttling detected</span>
                </div>
              ) : (
                <div className="space-y-2 max-h-[120px] overflow-y-auto">
                  {recentThrottles.map(e => (
                    <div key={e.id} className={`flex items-center justify-between text-xs py-1.5 px-2 rounded-lg ${
                      !e.resolvedAt ? 'bg-red-500/5 border border-red-500/10' : 'bg-forge-raised/50'
                    }`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${!e.resolvedAt ? 'bg-red-400 animate-pulse' : 'bg-zinc-600'}`} />
                        <span className="text-zinc-400">{e.direction === 'download' ? '↓' : '↑'}</span>
                        <span className="font-mono text-zinc-300">{formatSpeed(e.actualBps)}</span>
                        <span className="text-zinc-600">/</span>
                        <span className="font-mono text-zinc-500">{formatSpeed(e.targetBps)}</span>
                      </div>
                      <span className="text-zinc-600 font-mono">{timeAgo(e.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Row 2: Daily Usage Chart (full width) */}
      {dailyChartData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className="glass-card card-hover p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <BarChart3 size={14} className="text-blue-400" />
                </div>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Daily Usage (7 Days)</h3>
              </div>
              <div className="flex items-center gap-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-cyan-500" /> Download</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500" /> Upload</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={dailyChartData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} width={40} tickFormatter={v => `${v.toFixed(0)}G`} />
                <Tooltip
                  contentStyle={glassTooltipStyle}
                  labelStyle={{ color: '#a1a1aa' }}
                  formatter={(value: number, name: string) => [`${value.toFixed(2)} GB`, name === 'dl' ? 'Download' : 'Upload']}
                />
                <Bar dataKey="dl" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                <Bar dataKey="ul" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      )}

      {/* Row 3: Top Providers + Server Reliability */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Top Providers */}
        {providerStats.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="glass-card card-hover overflow-hidden">
              <div className="p-4">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <Globe size={14} className="text-purple-400" />
                  </div>
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Top Providers</h3>
                </div>
                <div className="space-y-2.5">
                  {providerStats.map((p, i) => {
                    const maxBytes = providerStats[0]?.totalBytes || 1
                    const pct = Math.max(4, (p.totalBytes / maxBytes) * 100)
                    return (
                      <div key={p.name} className="group/row">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-zinc-600 w-4 text-right">{i + 1}</span>
                            <span className="text-sm font-medium text-zinc-300">{p.name}</span>
                            <span className="text-[10px] text-zinc-600 font-mono">{p.healthy}/{p.servers}</span>
                          </div>
                          <span className="text-xs font-mono text-zinc-400">{formatBytes(p.totalBytes)}</span>
                        </div>
                        <div className="ml-6 h-1.5 bg-forge-raised rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-purple-500 to-violet-400 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Server Reliability */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className="glass-card card-hover overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Server size={14} className="text-emerald-400" />
                </div>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Server Reliability</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {/* Success rate ring */}
                <div className="flex items-center gap-3">
                  <div className="relative w-14 h-14 flex-shrink-0">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15" fill="none" stroke="#27272a" strokeWidth="3" />
                      <circle cx="18" cy="18" r="15" fill="none"
                        stroke={successRate >= 95 ? '#22c55e' : successRate >= 80 ? '#f59e0b' : '#ef4444'}
                        strokeWidth="3"
                        strokeDasharray={`${successRate * 0.942} 100`}
                        strokeLinecap="round"
                        className="transition-all duration-700"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-bold font-mono text-zinc-200">{successRate}%</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Success Rate</div>
                    <div className="text-sm font-mono text-zinc-300">{totalDownloads.toLocaleString()} reqs</div>
                  </div>
                </div>

                {/* Stats */}
                <div className="space-y-2.5">
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Total Failures</div>
                    <div className="text-sm font-bold font-mono text-zinc-300">{totalFailures.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Blocked Servers</div>
                    <div className={`text-sm font-bold font-mono ${blockedCount > 0 ? 'text-red-400' : 'text-zinc-300'}`}>
                      {blockedCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Providers</div>
                    <div className="text-sm font-bold font-mono text-zinc-300">
                      {new Set(serverHealth.map(s => extractProvider(s.url))).size}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Row 4: ISP Speed History + Schedule Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* ISP Speed History */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className="glass-card card-hover overflow-hidden">
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                    <Wifi size={14} className="text-cyan-400" />
                  </div>
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">ISP Speed History</h3>
                </div>
                {speedChartData.length > 0 && (
                  <span className="text-[10px] font-mono text-zinc-600">{speedChartData.length} tests</span>
                )}
              </div>
              {speedChartData.length === 0 ? (
                <div className="flex items-center justify-center h-[100px] text-sm text-zinc-600">
                  No speed tests recorded yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={speedChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="time" tick={{ fill: '#52525b', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: '#52525b', fontSize: 9 }} axisLine={false} tickLine={false} width={35} tickFormatter={v => `${v}`} />
                    <Tooltip
                      contentStyle={glassTooltipStyle}
                      formatter={(value: number, name: string) => [`${value.toFixed(1)} Mbps`, name === 'download' ? '↓ Download' : '↑ Upload']}
                    />
                    <Line type="monotone" dataKey="download" stroke="#06b6d4" strokeWidth={2} dot={{ r: 2, fill: '#06b6d4' }} />
                    <Line type="monotone" dataKey="upload" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2, fill: '#f59e0b' }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </motion.div>

        {/* Schedule Overview */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className="glass-card card-hover overflow-hidden">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                    <Timer size={14} className="text-cyan-400" />
                  </div>
                  <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Schedules</h3>
                </div>
                <span className="text-[10px] font-mono text-zinc-600">
                  {enabledSchedules.length}/{schedules.length} active
                </span>
              </div>
              {schedules.length === 0 ? (
                <div className="flex items-center justify-center h-[80px] text-sm text-zinc-600">
                  No schedules configured
                </div>
              ) : (
                <div className="space-y-2 max-h-[130px] overflow-y-auto">
                  {schedules.slice(0, 5).map(s => (
                    <div key={s.id} className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                      s.enabled ? 'bg-cyan-500/5 border border-cyan-500/10' : 'bg-forge-raised/30'
                    }`}>
                      <div className="flex items-center gap-2.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${s.enabled ? 'bg-cyan-400' : 'bg-zinc-600'}`} />
                        <div className="flex gap-0.5">
                          {[0,1,2,3,4,5,6].map(d => (
                            <span key={d} className={`text-[9px] font-mono w-4 text-center ${
                              s.daysOfWeek.includes(d)
                                ? s.enabled ? 'text-cyan-400 font-bold' : 'text-zinc-400 font-bold'
                                : 'text-zinc-700'
                            }`}>{dayLabels[d][0]}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-zinc-400">{s.startTime}–{s.endTime}</span>
                        <span className="text-[10px] font-mono text-zinc-600">
                          ↓{s.downloadMbps} ↑{s.uploadMbps}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* Next scheduled event from WS */}
              {stats.nextScheduledTime && (
                <div className="mt-3 flex items-center gap-2 pt-2 border-t border-white/[0.04]">
                  <ChevronRight size={12} className="text-cyan-400" />
                  <span className="text-xs text-zinc-400">
                    Next: <span className="text-zinc-300 font-medium">{stats.nextScheduledEvent}</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Row 5: System Status + Engine Config */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* System Status */}
        {updateStatus && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.40, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="glass-card card-hover overflow-hidden">
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                      <RefreshCw size={14} className="text-indigo-400" />
                    </div>
                    <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">System Status</h3>
                  </div>
                  {updateStatus.updateAvailable ? (
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                      Update Available
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                      Up to Date
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Version</div>
                    <div className="text-sm font-mono text-zinc-300 truncate">{updateStatus.currentVersion || 'dev'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Build Date</div>
                    <div className="text-sm font-mono text-zinc-300">{updateStatus.currentBuildDate || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Auto Update</div>
                    <div className={`text-sm font-medium ${updateStatus.autoUpdateEnabled ? 'text-emerald-400' : 'text-zinc-500'}`}>
                      {updateStatus.autoUpdateEnabled ? `On (${updateStatus.autoUpdateSchedule})` : 'Off'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Docker</div>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${updateStatus.dockerAvailable ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className={`text-sm font-medium ${updateStatus.dockerAvailable ? 'text-emerald-400' : 'text-red-400'}`}>
                        {updateStatus.dockerAvailable ? 'Connected' : 'Unavailable'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Engine Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.40, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className="glass-card card-hover overflow-hidden">
            <div className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center">
                  <Zap size={14} className="text-rose-400" />
                </div>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Engine Configuration</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Mode</div>
                  <div className="flex items-center gap-1.5">
                    {stats.autoMode === 'max'
                      ? <Zap size={13} className="text-red-400" />
                      : <Shield size={13} className="text-cyan-400" />
                    }
                    <span className="text-sm font-medium text-zinc-300 capitalize">{stats.autoMode || 'reliable'}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Streams</div>
                  <div className="text-sm font-mono text-zinc-300">
                    ↓{stats.downloadStreams} ↑{stats.uploadStreams}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Total Servers</div>
                  <div className="text-sm font-mono text-zinc-300">{stats.totalServers}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Uptime</div>
                  <div className="text-sm font-mono text-zinc-300">
                    {stats.uptimeSeconds > 0 ? formatDuration(stats.uptimeSeconds) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Session Data</div>
                  <div className="text-sm font-mono text-zinc-300">
                    {formatBytes(stats.sessionDownloadBytes + stats.sessionUploadBytes)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-0.5">Throttle Events</div>
                  <div className={`text-sm font-bold font-mono ${throttleEvents.length > 0 ? 'text-amber-400' : 'text-zinc-300'}`}>
                    {throttleEvents.length}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}
