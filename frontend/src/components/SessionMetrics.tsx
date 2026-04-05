import { Timer, ArrowDownCircle, ArrowUpCircle, Database, TrendingUp, Activity } from 'lucide-react'
import { motion } from 'framer-motion'
import { WsStats } from '../hooks/useWebSocket'
import { EngineEvent } from '../api/client'

interface SessionMetricsProps {
  stats: WsStats
  events: EngineEvent[]
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${(bytes / 1e6).toFixed(1)} MB`
}

function formatSpeed(bps: number): string {
  const gbps = bps / 1_000_000_000
  if (gbps >= 1) return `${gbps.toFixed(2)} Gbps`
  return `${(bps / 1_000_000).toFixed(0)} Mbps`
}

export default function SessionMetrics({ stats, events }: SessionMetricsProps) {
  const totalBytes = stats.sessionDownloadBytes + stats.sessionUploadBytes
  const gbPerHour = stats.uptimeSeconds > 0
    ? (totalBytes / 1e9) / (stats.uptimeSeconds / 3600)
    : 0
  const avgDownload = stats.uptimeSeconds > 0
    ? (stats.sessionDownloadBytes * 8) / stats.uptimeSeconds
    : 0
  const avgUpload = stats.uptimeSeconds > 0
    ? (stats.sessionUploadBytes * 8) / stats.uptimeSeconds
    : 0

  // Last 3 meaningful events (filter out noisy adjust events)
  const recentEvents = events
    .slice()
    .reverse()
    .filter(e => e.kind !== 'adjust')
    .slice(0, 3)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-zinc-500" />
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Session</h3>
      </div>

      {/* Uptime hero */}
      <div className="flex items-center gap-2">
        <Timer size={14} className="text-cyan-400" />
        <motion.span
          key={stats.uptimeSeconds}
          initial={{ opacity: 0.7 }}
          animate={{ opacity: 1 }}
          className="text-lg font-bold font-mono text-zinc-100 tabular-nums"
        >
          {formatDuration(stats.uptimeSeconds)}
        </motion.span>
      </div>

      {/* Data transferred */}
      <div className="space-y-1.5 rounded-lg bg-forge-inset glass-inset border border-white/[0.03] p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ArrowDownCircle size={11} className="text-cyan-400" />
            <span className="text-xs font-mono text-zinc-300 tabular-nums">{formatBytes(stats.sessionDownloadBytes)}</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-600">avg {formatSpeed(avgDownload)}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ArrowUpCircle size={11} className="text-amber-400" />
            <span className="text-xs font-mono text-zinc-300 tabular-nums">{formatBytes(stats.sessionUploadBytes)}</span>
          </div>
          <span className="text-[10px] font-mono text-zinc-600">avg {formatSpeed(avgUpload)}</span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-white/[0.04]">
          <div className="flex items-center gap-1.5">
            <Database size={11} className="text-zinc-500" />
            <span className="text-xs font-bold font-mono text-zinc-200 tabular-nums">{formatBytes(totalBytes)}</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp size={10} className="text-zinc-500" />
            <span className="text-[10px] font-mono text-zinc-400">{gbPerHour.toFixed(1)} GB/hr</span>
          </div>
        </div>
      </div>

      {/* Recent activity - compact feed */}
      {recentEvents.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-white/[0.04]">
          <div className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Recent</div>
          {recentEvents.map((e, i) => (
            <div key={`${e.time}-${i}`} className="flex items-start gap-1.5 text-[10px]">
              <span className={`w-1 h-1 rounded-full mt-1 flex-shrink-0 ${
                e.kind === 'stream' ? 'bg-cyan-400' :
                e.kind === 'server' ? 'bg-amber-400' :
                e.kind === 'test' ? 'bg-violet-400' :
                'bg-zinc-500'
              }`} />
              <span className="text-zinc-500 truncate">{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
