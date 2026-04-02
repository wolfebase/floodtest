import { WsStats } from '../hooks/useWebSocket'

interface ThroughputColumnProps {
  stats: WsStats
  mode: string
}

function formatSpeed(bps: number): string {
  const gbps = bps / 1_000_000_000
  if (gbps >= 1) return `${gbps.toFixed(2)} Gbps`
  return `${(bps / 1_000_000).toFixed(0)} Mbps`
}

export default function ThroughputColumn({ stats, mode }: ThroughputColumnProps) {
  const targetBps = stats.measuredDownloadMbps * 1_000_000 * 0.9
  const efficiency = targetBps > 0 ? Math.min(100, Math.round((stats.downloadBps / targetBps) * 100)) : 0

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Throughput</h3>

      <div className="space-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-gray-500 text-xs">↓</span>
          <span className="text-xl font-bold text-white tabular-nums">
            {formatSpeed(stats.downloadBps)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-gray-500 text-xs">↑</span>
          <span className="text-xl font-bold text-white tabular-nums">
            {formatSpeed(stats.uploadBps)}
          </span>
        </div>
      </div>

      {mode === 'reliable' && targetBps > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Target: {formatSpeed(targetBps)}</span>
            <span className="text-gray-400 font-medium">{efficiency}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                efficiency >= 80 ? 'bg-green-500' : efficiency >= 50 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, efficiency)}%` }}
            />
          </div>
        </div>
      )}

      {mode === 'max' && (
        <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-red-900/30 text-red-400 border border-red-900/50">
          Unlimited
        </span>
      )}

      <div className="text-sm text-gray-400">
        {stats.downloadStreams} ↓ · {stats.uploadStreams} ↑ streams
      </div>
    </div>
  )
}
