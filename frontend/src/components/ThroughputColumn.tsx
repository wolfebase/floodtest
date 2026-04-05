import { ArrowDown, ArrowUp, Gauge, Zap, TrendingUp } from 'lucide-react'
import { motion } from 'framer-motion'
import { WsStats } from '../hooks/useWebSocket'

interface ThroughputColumnProps {
  stats: WsStats
  mode: string
  sparkline: number[]
}

function formatSpeed(bps: number): string {
  const gbps = bps / 1_000_000_000
  if (gbps >= 1) return `${gbps.toFixed(2)} Gbps`
  return `${(bps / 1_000_000).toFixed(0)} Mbps`
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${(bytes / 1e6).toFixed(1)} MB`
}

function MiniSparkline({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const w = 200
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = height - (v / max) * (height - 2) - 1
    return `${x},${y}`
  }).join(' ')

  // Build area fill path
  const areaPath = `M0,${height} ` + data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = height - (v / max) * (height - 2) - 1
    return `L${x},${y}`
  }).join(' ') + ` L${w},${height} Z`

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${color})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function ThroughputColumn({ stats, mode, sparkline }: ThroughputColumnProps) {
  const targetBps = stats.measuredDownloadMbps * 1_000_000 * 0.9
  const efficiency = targetBps > 0 ? Math.min(100, Math.round((stats.downloadBps / targetBps) * 100)) : 0
  const peakDl = stats.peakDownloadBps ?? 0
  const peakUl = stats.peakUploadBps ?? 0
  const dlPeakPct = peakDl > 0 ? Math.min(100, Math.round((stats.downloadBps / peakDl) * 100)) : 0
  const ulPeakPct = peakUl > 0 ? Math.min(100, Math.round((stats.uploadBps / peakUl) * 100)) : 0

  // Calculate transfer rate (GB/hr)
  const totalBytes = stats.sessionDownloadBytes + stats.sessionUploadBytes
  const gbPerHour = stats.uptimeSeconds > 0
    ? (totalBytes / 1e9) / (stats.uptimeSeconds / 3600)
    : 0

  const dlSpeed = formatSpeed(stats.downloadBps)
  const ulSpeed = formatSpeed(stats.uploadBps)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Gauge size={14} className="text-zinc-500" />
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Throughput</h3>
      </div>

      {/* Speed displays */}
      <div className="space-y-2">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-cyan-500/10 flex items-center justify-center">
              <ArrowDown size={12} className="text-cyan-400" />
            </div>
            <motion.span
              key={dlSpeed}
              initial={{ opacity: 0.7, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="text-2xl font-bold text-cyan-400 font-mono tabular-nums leading-none"
            >
              {dlSpeed}
            </motion.span>
          </div>
          {/* Current vs Peak bar */}
          {peakDl > 0 && (
            <div className="ml-7 mt-1 flex items-center gap-2">
              <div className="flex-1 h-1 bg-forge-raised rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500/60 rounded-full transition-all duration-300" style={{ width: `${dlPeakPct}%` }} />
              </div>
              <span className="text-[10px] text-zinc-600 font-mono">{formatSpeed(peakDl)} pk</span>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-amber-500/10 flex items-center justify-center">
              <ArrowUp size={12} className="text-amber-400" />
            </div>
            <motion.span
              key={ulSpeed}
              initial={{ opacity: 0.7, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="text-2xl font-bold text-amber-400 font-mono tabular-nums leading-none"
            >
              {ulSpeed}
            </motion.span>
          </div>
          {peakUl > 0 && (
            <div className="ml-7 mt-1 flex items-center gap-2">
              <div className="flex-1 h-1 bg-forge-raised rounded-full overflow-hidden">
                <div className="h-full bg-amber-500/60 rounded-full transition-all duration-300" style={{ width: `${ulPeakPct}%` }} />
              </div>
              <span className="text-[10px] text-zinc-600 font-mono">{formatSpeed(peakUl)} pk</span>
            </div>
          )}
        </div>
      </div>

      {/* Sparkline */}
      {sparkline.length > 2 && (
        <div className="rounded-lg bg-forge-inset glass-inset border border-white/[0.03] p-1.5 overflow-hidden">
          <MiniSparkline data={sparkline} color="#06b6d4" height={28} />
        </div>
      )}

      {/* Efficiency bar */}
      {mode === 'reliable' && targetBps > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-600 font-mono">Target: {formatSpeed(targetBps)}</span>
            <span className={`font-bold font-mono ${efficiency >= 90 ? 'text-emerald-400' : efficiency >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
              {efficiency}%
            </span>
          </div>
          <div className="relative h-1.5 bg-forge-raised rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                efficiency >= 90 ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                : efficiency >= 70 ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                : 'bg-gradient-to-r from-red-500 to-red-400'
              }`}
              style={{ width: `${Math.min(100, efficiency)}%` }}
            />
          </div>
        </div>
      )}

      {mode === 'max' && (
        <div className="flex items-center gap-1.5">
          <Zap size={11} className="text-red-400" />
          <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Unlimited</span>
        </div>
      )}

      {/* Bottom metrics row */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/[0.04]">
        <div>
          <div className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Streams</div>
          <div className="text-xs font-mono text-zinc-300 flex items-center gap-1.5 mt-0.5">
            <span className="text-cyan-400">↓{stats.downloadStreams}</span>
            <span className="text-amber-400">↑{stats.uploadStreams}</span>
          </div>
        </div>
        <div>
          <div className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Rate</div>
          <div className="flex items-center gap-1 mt-0.5">
            <TrendingUp size={10} className="text-zinc-500" />
            <span className="text-xs font-mono text-zinc-300">{gbPerHour.toFixed(1)} GB/hr</span>
          </div>
        </div>
      </div>
    </div>
  )
}
