import { useRef } from 'react'
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

const kindColor: Record<string, string> = {
  stream: 'text-blue-400',
  server: 'text-amber-400',
  adjust: 'text-green-400',
  test: 'text-purple-400',
}

export default function EngineLog({ events }: EngineLogProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Engine Log</h3>
      <div
        ref={containerRef}
        className="h-40 overflow-y-auto space-y-0.5 scrollbar-thin scrollbar-thumb-gray-700"
      >
        {events.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No events yet</p>
        ) : (
          events.slice().reverse().map((e, i) => (
            <div key={`${e.time}-${i}`} className="flex gap-2 text-xs font-mono">
              <span className="text-gray-600 flex-shrink-0">{formatTime(e.time)}</span>
              <span className={`${kindColor[e.kind] || 'text-gray-400'} truncate`}>
                {e.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
