import { useState, useEffect, useMemo, useCallback } from 'react'
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

// ── Helper functions ──────────────────────────────────────────────────


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

// ── Status counts ─────────────────────────────────────────────────────

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

// ── Inline status badges for the header ───────────────────────────────

function InlineStatusCounts({ counts }: { counts: StatusCounts }) {
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className="text-zinc-400">
        <span className="text-zinc-50 font-medium">{counts.total}</span> Total
      </span>
      {counts.healthy > 0 && (
        <span className="text-emerald-400">
          <span className="font-medium">{counts.healthy}</span> Healthy
        </span>
      )}
      {counts.cooldown > 0 && (
        <span className="text-amber-400">
          <span className="font-medium">{counts.cooldown}</span> Cooldown
        </span>
      )}
      {counts.failed > 0 && (
        <span className="text-red-400">
          <span className="font-medium">{counts.failed}</span> Failed
        </span>
      )}
      {counts.blocked > 0 && (
        <span className="text-red-400">
          <span className="font-medium">{counts.blocked}</span> Blocked
        </span>
      )}
      {counts.testing > 0 && (
        <span className="text-amber-400">
          <span className="font-medium">{counts.testing}</span> Testing
        </span>
      )}
    </span>
  )
}


// ── Main component ────────────────────────────────────────────────────

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
      <div className="bg-forge-surface rounded-lg border border-forge-border p-4">
        <div className="text-sm text-zinc-500">Loading server health...</div>
      </div>
    )
  }

  const completed = speedTestCompleted ?? 0
  const total = speedTestTotal ?? 0
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="space-y-2">
      {/* Provider Breakdown summary */}
      {providerGroups.length > 0 && (
        <div className="bg-forge-surface rounded-lg border border-forge-border p-3 mb-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wide mb-2 block">Provider Breakdown</span>
          {providerGroups.sort((a, b) => b.totalSpeedBps - a.totalSpeedBps).map(g => (
            <div key={g.name} className="flex items-center gap-2 mb-1">
              <span className="text-xs text-zinc-300 w-24 truncate">{g.name}</span>
              <div className="flex-1 h-2 bg-forge-raised rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(g.totalSpeedBps / maxProviderSpeed) * 100}%` }} />
              </div>
              <span className="text-xs font-mono text-zinc-400 w-20 text-right">
                {g.totalSpeedBps > 1e9 ? (g.totalSpeedBps / 1e9).toFixed(1) + ' Gbps' : (g.totalSpeedBps / 1e6).toFixed(0) + ' Mbps'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Download Servers Section */}
      <div className="bg-forge-surface rounded-lg border border-forge-border overflow-hidden">
        {/* Collapsible header */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-forge-raised/50 transition-colors border-b border-orange-900/30"
          onClick={toggleDownload}
        >
          <div className="flex items-center gap-3">
            <span className="text-orange-400 text-sm">
              {downloadCollapsed ? '\u25B8' : '\u25BE'}
            </span>
            <span className="text-sm font-semibold text-orange-400">Download Servers</span>
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
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800"
              >
                Unblock All ({downloadCounts.blocked})
              </button>
            )}
            <button
              onClick={handleSpeedTest}
              disabled={isRunning}
              className="px-4 py-1.5 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-600 text-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Testing...' : 'Run Speed Test'}
            </button>
          </div>
        </div>

        {/* Speed Test Progress Bar — between header and table */}
        {!downloadCollapsed && isRunning && total > 0 && (
          <div className="px-4 py-3 border-b border-forge-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-zinc-400">
                Testing servers... {completed}/{total} complete
              </span>
              <span className="text-sm text-zinc-500">{pct}%</span>
            </div>
            <div className="bg-forge-raised rounded-full h-2">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-500 ease-out"
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
      </div>

      {/* Upload Servers Section */}
      <div className="bg-forge-surface rounded-lg border border-forge-border overflow-hidden">
        {/* Collapsible header */}
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 cursor-pointer select-none hover:bg-forge-raised/50 transition-colors border-b border-slate-700/30"
          onClick={toggleUpload}
        >
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm">
              {uploadCollapsed ? '\u25B8' : '\u25BE'}
            </span>
            <span className="text-sm font-semibold text-slate-400">Upload Servers</span>
            <InlineStatusCounts counts={uploadCounts} />
          </div>

          <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {uploadCounts.blocked > 0 && (
              <button
                onClick={handleUnblockAllUploads}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800"
              >
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
      </div>
    </div>
  )
}
