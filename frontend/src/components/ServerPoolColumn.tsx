import { WsStats } from '../hooks/useWebSocket'

interface ServerPoolColumnProps {
  stats: WsStats
  providerCount: number
}

export default function ServerPoolColumn({ stats, providerCount }: ServerPoolColumnProps) {
  const healthy = stats.healthyServers
  const total = stats.totalServers

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Server Pool</h3>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm text-zinc-300">{healthy} healthy</span>
        </div>
        {total - healthy > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-sm text-zinc-300">{total - healthy} unhealthy</span>
          </div>
        )}
      </div>

      <div className="space-y-1 text-sm text-zinc-400">
        <div>{providerCount} providers</div>
        <div>{stats.downloadStreams + stats.uploadStreams} active streams</div>
      </div>
    </div>
  )
}
