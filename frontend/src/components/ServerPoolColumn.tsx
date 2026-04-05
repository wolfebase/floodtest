import { Server, CheckCircle, AlertCircle, Globe, Waves } from 'lucide-react'
import { motion } from 'framer-motion'
import { WsStats } from '../hooks/useWebSocket'
import { ProviderGroup } from '../utils/providerGrouping'

interface ServerPoolColumnProps {
  stats: WsStats
  providerGroups: ProviderGroup[]
}

function formatSpeed(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)}G`
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(0)}M`
  return `${(bps / 1e3).toFixed(0)}K`
}

export default function ServerPoolColumn({ stats, providerGroups }: ServerPoolColumnProps) {
  const healthy = stats.healthyServers
  const total = stats.totalServers
  const unhealthy = total - healthy
  const healthPct = total > 0 ? Math.round((healthy / total) * 100) : 0
  const totalStreams = stats.downloadStreams + stats.uploadStreams

  // Top providers by speed, max 5
  const topProviders = providerGroups
    .filter(p => p.activeStreams > 0)
    .sort((a, b) => b.totalSpeedBps - a.totalSpeedBps)
    .slice(0, 5)
  const maxProviderSpeed = topProviders.length > 0 ? topProviders[0].totalSpeedBps : 1

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Server size={14} className="text-zinc-500" />
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Network</h3>
      </div>

      {/* Compact health summary */}
      <div className="flex items-center gap-3 glass-inset rounded-lg p-2.5">
        {/* Mini health ring */}
        <div className="relative w-11 h-11 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#27272a" strokeWidth="3" />
            <circle
              cx="18" cy="18" r="15" fill="none"
              stroke={healthPct >= 90 ? '#22c55e' : healthPct >= 60 ? '#f59e0b' : '#ef4444'}
              strokeWidth="3"
              strokeDasharray={`${healthPct * 0.942} 100`}
              strokeLinecap="round"
              className="transition-all duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] font-bold font-mono text-zinc-200">{healthPct}%</span>
          </div>
        </div>

        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <CheckCircle size={11} className="text-emerald-500" />
            <span className="text-xs text-zinc-300">{healthy} healthy</span>
          </div>
          {unhealthy > 0 && (
            <div className="flex items-center gap-1.5">
              <AlertCircle size={11} className="text-amber-500" />
              <span className="text-xs text-zinc-400">{unhealthy} degraded</span>
            </div>
          )}
        </div>
      </div>

      {/* Provider breakdown bars */}
      {topProviders.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Active Providers</div>
          {topProviders.map((p, i) => {
            const pct = Math.max(6, (p.totalSpeedBps / maxProviderSpeed) * 100)
            return (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3 }}
                className="flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                <span className="text-[10px] text-zinc-400 w-14 truncate">{p.name}</span>
                <div className="flex-1 h-1.5 bg-forge-raised rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: p.color }}
                  />
                </div>
                <span className="text-[10px] font-mono text-zinc-500 w-8 text-right">{formatSpeed(p.totalSpeedBps)}</span>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Bottom metrics */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/[0.04]">
        <div>
          <div className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Providers</div>
          <div className="flex items-center gap-1 mt-0.5">
            <Globe size={10} className="text-zinc-500" />
            <span className="text-xs font-mono text-zinc-300">{providerGroups.length}</span>
          </div>
        </div>
        <div>
          <div className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">Streams</div>
          <div className="flex items-center gap-1 mt-0.5">
            <Waves size={10} className="text-zinc-500" />
            <span className="text-xs font-mono text-zinc-300">{totalStreams}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
