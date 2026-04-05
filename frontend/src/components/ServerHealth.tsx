import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDownCircle, ArrowUpCircle, Globe, AlertCircle, Zap,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { api, ServerHealth as ServerHealthData, UploadServerHealth as UploadServerHealthData, SpeedTestResult } from '../api/client'
import { groupDownloadServers } from '../utils/providerGrouping'
import ProviderAccordion from './ProviderAccordion'

interface Props {
  speedTestRunning?: boolean
  speedTestCompleted?: number
  speedTestTotal?: number
}

// Normalized shape used by the shared table component
interface NormalizedServer {
  url: string
  location: string
  healthy: boolean
  blocked: boolean
  consecutiveFailures: number
  totalFailures: number
  totalCount: number
  lastError?: string
  lastErrorTime?: string
  unhealthyUntil?: string
  bytesTransferred: number
  speedBps: number
  activeStreams: number
  status: string
}

type SectionType = 'download' | 'upload'

// -- Helper functions --

function normalizeDownload(s: ServerHealthData): NormalizedServer {
  return {
    url: s.url,
    location: s.location,
    healthy: s.healthy,
    blocked: s.blocked,
    consecutiveFailures: s.consecutiveFailures,
    totalFailures: s.totalFailures,
    totalCount: s.totalDownloads,
    lastError: s.lastError,
    lastErrorTime: s.lastErrorTime,
    unhealthyUntil: s.unhealthyUntil,
    bytesTransferred: s.bytesDownloaded,
    speedBps: s.speedBps,
    activeStreams: s.activeStreams,
    status: s.status,
  }
}

function normalizeUpload(s: UploadServerHealthData): NormalizedServer {
  return {
    url: s.url,
    location: s.location,
    healthy: s.healthy,
    blocked: s.blocked,
    consecutiveFailures: s.consecutiveFailures,
    totalFailures: s.totalFailures,
    totalCount: s.totalUploads,
    lastError: s.lastError,
    lastErrorTime: s.lastErrorTime,
    unhealthyUntil: s.unhealthyUntil,
    bytesTransferred: s.bytesUploaded,
    speedBps: s.speedBps,
    activeStreams: s.activeStreams,
    status: s.status,
  }
}

function getCollapsed(section: SectionType): boolean {
  try {
    return localStorage.getItem(`serverHealth.${section}.collapsed`) === 'true'
  } catch {
    return false
  }
}

function setCollapsed(section: SectionType, collapsed: boolean) {
  try {
    localStorage.setItem(`serverHealth.${section}.collapsed`, String(collapsed))
  } catch {
    // ignore storage errors
  }
}

// -- Status counts --

interface StatusCounts {
  total: number
  healthy: number
  cooldown: number
  failed: number
  blocked: number
  testing: number
}

function computeCounts(servers: NormalizedServer[]): StatusCounts {
  return {
    total: servers.length,
    healthy: servers.filter((s) => s.status === 'healthy').length,
    cooldown: servers.filter((s) => s.status === 'cooldown').length,
    failed: servers.filter((s) => s.status === 'failed').length,
    blocked: servers.filter((s) => s.status === 'blocked').length,
    testing: servers.filter((s) => s.status === 'testing').length,
  }
}

// -- Inline status badges for the header --

function InlineStatusCounts({ counts }: { counts: StatusCounts }) {
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800/60 text-xs">
        <span className="text-zinc-100 font-medium font-mono">{counts.total}</span>
        <span className="text-zinc-500">Total</span>
      </span>
      {counts.healthy > 0 && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-emerald-400 font-medium font-mono">{counts.healthy}</span>
          <span className="text-emerald-400/70">Healthy</span>
        </span>
      )}
      {counts.cooldown > 0 && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="text-amber-400 font-medium font-mono">{counts.cooldown}</span>
          <span className="text-amber-400/70">Cooldown</span>
        </span>
      )}
      {counts.failed > 0 && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <span className="text-red-400 font-medium font-mono">{counts.failed}</span>
          <span className="text-red-400/70">Failed</span>
        </span>
      )}
      {counts.blocked > 0 && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-red-400 font-medium font-mono">{counts.blocked}</span>
          <span className="text-red-400/70">Blocked</span>
        </span>
      )}
      {counts.testing > 0 && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-amber-400 font-medium font-mono">{counts.testing}</span>
          <span className="text-amber-400/70">Testing</span>
        </span>
      )}
    </span>
  )
}


// -- Main component --

export default function ServerHealth({ speedTestRunning, speedTestCompleted, speedTestTotal }: Props) {
  const [downloadServers, setDownloadServers] = useState<ServerHealthData[]>([])
  const [uploadServers, setUploadServers] = useState<UploadServerHealthData[]>([])
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [lastTestTime, setLastTestTime] = useState<string | null>(null)
  const [downloadCollapsed, setDownloadCollapsed] = useState(() => getCollapsed('download'))
  const [uploadCollapsed, setUploadCollapsed] = useState(() => getCollapsed('upload'))

  const isRunning = speedTestRunning || testing

  // Fetch both download and upload health on same interval
  useEffect(() => {
    const fetchHealth = () => {
      Promise.all([
        api.getServerHealth(),
        api.getUploadServerHealth(),
      ]).then(([dl, ul]) => {
        setDownloadServers(dl)
        setUploadServers(ul)
        setLoading(false)
      }).catch(() => {
        setLoading(false)
      })
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleSpeedTest = async () => {
    setTesting(true)
    try {
      const _results: SpeedTestResult[] = await api.runSpeedTest()
      void _results
      setLastTestTime(new Date().toISOString())
      const data = await api.getServerHealth()
      setDownloadServers(data)
    } catch {
      // ignore errors
    } finally {
      setTesting(false)
    }
  }

  const handleUnblockDownload = useCallback(async (url: string) => {
    try {
      await api.unblockServer(url)
    } catch (err) {
      console.error('Unblock failed:', err)
    }
  }, [])

  const handleUnblockAllDownloads = async () => {
    try {
      await api.unblockAll()
    } catch (err) {
      console.error('Unblock all failed:', err)
    }
  }

  const handleUnblockUpload = useCallback(async (url: string) => {
    try {
      await api.unblockUploadServer(url)
    } catch (err) {
      console.error('Unblock upload failed:', err)
    }
  }, [])

  const handleUnblockAllUploads = async () => {
    try {
      await api.unblockAllUploads()
    } catch (err) {
      console.error('Unblock all uploads failed:', err)
    }
  }

  const toggleDownload = () => {
    const next = !downloadCollapsed
    setDownloadCollapsed(next)
    setCollapsed('download', next)
  }

  const toggleUpload = () => {
    const next = !uploadCollapsed
    setUploadCollapsed(next)
    setCollapsed('upload', next)
  }

  // Normalize data
  const normalizedDownloads = useMemo(() => downloadServers.map(normalizeDownload), [downloadServers])
  const normalizedUploads = useMemo(() => uploadServers.map(normalizeUpload), [uploadServers])

  const downloadCounts = useMemo(() => computeCounts(normalizedDownloads), [normalizedDownloads])
  const uploadCounts = useMemo(() => computeCounts(normalizedUploads), [normalizedUploads])

  // Provider throughput summary
  const providerGroups = useMemo(() => groupDownloadServers(downloadServers), [downloadServers])
  const maxProviderSpeed = useMemo(() => Math.max(...providerGroups.map(g => g.totalSpeedBps), 1), [providerGroups])

  if (loading) {
    return (
      <div className="space-y-5 max-w-[1400px]">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Servers</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Download & upload server health monitoring</p>
        </div>
        <div className="glass-card p-6">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            <span className="text-sm text-zinc-500">Loading server health...</span>
          </div>
        </div>
      </div>
    )
  }

  const completed = speedTestCompleted ?? 0
  const total = speedTestTotal ?? 0
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="space-y-5 max-w-[1400px]">
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0 }}
      >
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Servers</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Download & upload server health monitoring</p>
      </motion.div>

      {/* Provider Breakdown summary */}
      {providerGroups.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="glass-card card-hover p-4"
        >
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Globe size={14} className="text-purple-400" />
            </div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Provider Breakdown</h3>
          </div>
          <div className="space-y-2.5">
            {providerGroups.sort((a, b) => b.totalSpeedBps - a.totalSpeedBps).map((g, i) => (
              <div key={g.name} className="group/row">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-600 w-4 text-right">{i + 1}</span>
                    <span className="text-sm font-medium text-zinc-300">{g.name}</span>
                  </div>
                  <span className="text-xs font-mono text-zinc-400">
                    {g.totalSpeedBps > 1e9 ? (g.totalSpeedBps / 1e9).toFixed(1) + ' Gbps' : (g.totalSpeedBps / 1e6).toFixed(0) + ' Mbps'}
                  </span>
                </div>
                <div className="ml-6 h-2 bg-forge-raised rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(4, (g.totalSpeedBps / maxProviderSpeed) * 100)}%`,
                      backgroundColor: g.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Download Servers Section */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="glass-card overflow-hidden"
      >
        {/* Collapsible header */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-white/[0.03] transition-colors border-b border-cyan-500/20"
          onClick={toggleDownload}
        >
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
              <ArrowDownCircle size={14} className="text-cyan-400" />
            </div>
            <div className="flex items-center gap-2">
              {downloadCollapsed
                ? <ChevronRight size={14} className="text-cyan-400" />
                : <ChevronDown size={14} className="text-cyan-400" />
              }
              <span className="text-sm font-semibold text-cyan-400">Download Servers</span>
            </div>
            <InlineStatusCounts counts={downloadCounts} />
          </div>

          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {lastTestTime && (
              <span className="text-xs text-zinc-500">
                Last test: {new Date(lastTestTime).toLocaleTimeString()}
              </span>
            )}
            {downloadCounts.blocked > 0 && (
              <button
                onClick={handleUnblockAllDownloads}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-red-400 border border-red-500/30 bg-red-500/5 hover:bg-red-500/15 transition-colors"
              >
                <AlertCircle size={13} />
                Unblock All ({downloadCounts.blocked})
              </button>
            )}
            <button
              onClick={handleSpeedTest}
              disabled={isRunning}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-cyan-500 hover:bg-cyan-400 text-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm shadow-cyan-500/20"
            >
              {isRunning ? (
                <span className="flex items-center gap-2">
                  <Zap size={13} className="animate-pulse" />
                  Testing...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Zap size={13} />
                  Run Speed Test
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Speed Test Progress Bar */}
        {!downloadCollapsed && isRunning && total > 0 && (
          <div className="px-4 py-3 border-b border-forge-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-zinc-400">
                Testing servers... <span className="font-mono text-zinc-300">{completed}/{total}</span> complete
              </span>
              <span className="text-sm font-mono text-cyan-400">{pct}%</span>
            </div>
            <div className="relative h-2 bg-forge-raised rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full transition-all duration-500 ease-out progress-shimmer"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Provider-grouped accordion */}
        {!downloadCollapsed && (
          <ProviderAccordion
            downloadServers={downloadServers}
            onUnblock={handleUnblockDownload}
          />
        )}
      </motion.div>

      {/* Upload Servers Section */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24 }}
        className="glass-card overflow-hidden"
      >
        {/* Collapsible header */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-white/[0.03] transition-colors border-b border-amber-500/20"
          onClick={toggleUpload}
        >
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <ArrowUpCircle size={14} className="text-amber-400" />
            </div>
            <div className="flex items-center gap-2">
              {uploadCollapsed
                ? <ChevronRight size={14} className="text-amber-400" />
                : <ChevronDown size={14} className="text-amber-400" />
              }
              <span className="text-sm font-semibold text-amber-400">Upload Servers</span>
            </div>
            <InlineStatusCounts counts={uploadCounts} />
          </div>

          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {uploadCounts.blocked > 0 && (
              <button
                onClick={handleUnblockAllUploads}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-red-400 border border-red-500/30 bg-red-500/5 hover:bg-red-500/15 transition-colors"
              >
                <AlertCircle size={13} />
                Unblock All ({uploadCounts.blocked})
              </button>
            )}
          </div>
        </div>

        {/* Provider-grouped accordion */}
        {!uploadCollapsed && (
          <ProviderAccordion
            uploadServers={uploadServers}
            onUnblock={handleUnblockUpload}
          />
        )}
      </motion.div>
    </div>
  )
}
