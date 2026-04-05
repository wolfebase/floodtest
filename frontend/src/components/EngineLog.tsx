import { useRef } from 'react'
import { Terminal } from 'lucide-react'
import { EngineEvent } from '../api/client'

interface EngineLogProps {
  events: EngineEvent[]
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

const kindConfig: Record<string, { color: string; dot: string }> = {
  stream: { color: 'text-cyan-400', dot: 'bg-cyan-400' },
  server: { color: 'text-amber-400', dot: 'bg-amber-400' },
  adjust: { color: 'text-emerald-400', dot: 'bg-emerald-400' },
  test:   { color: 'text-violet-400', dot: 'bg-violet-400' },
}

export default function EngineLog({ events }: EngineLogProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Terminal size={14} className="text-zinc-500" />
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Engine Log</h3>
        {events.length > 0 && (
          <span className="text-[10px] font-mono text-zinc-600 ml-auto">{events.length} events</span>
        )}
      </div>
      <div
        ref={containerRef}
        className="h-40 overflow-y-auto space-y-0.5 pr-1 glass-inset rounded-xl p-3"
      >
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-zinc-600 italic">Waiting for events...</p>
          </div>
        ) : (
          events.slice().reverse().map((e, i) => {
            const cfg = kindConfig[e.kind] || { color: 'text-zinc-400', dot: 'bg-zinc-500' }
            return (
              <div
                key={`${e.time}-${i}`}
                className="flex items-start gap-2 text-xs font-mono py-0.5"
              >
                <span className="text-zinc-600 flex-shrink-0 tabular-nums">{formatTime(e.time)}</span>
                <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} flex-shrink-0 mt-1`} />
                <span className={`${cfg.color} truncate`}>{e.message}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
