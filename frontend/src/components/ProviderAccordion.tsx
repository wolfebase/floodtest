import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronRight, Unlock } from 'lucide-react'
import { ServerHealth, UploadServerHealth } from '../api/client'
import { extractProvider } from '../utils/providerGrouping'

// -- Types --

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

interface ProviderSection {
  name: string
  color: string
  servers: NormalizedServer[]
  totalSpeed: number
  healthyCount: number
}

export interface ProviderAccordionProps {
  downloadServers?: ServerHealth[]
  uploadServers?: UploadServerHealth[]
  onUnblock?: (url: string) => void
}

// -- Color palette (Tailwind classes) --

const PROVIDER_DOT_COLORS = [
  'bg-amber-500', 'bg-orange-500', 'bg-yellow-500', 'bg-red-500', 'bg-emerald-500',
  'bg-rose-500', 'bg-violet-500', 'bg-cyan-500', 'bg-lime-500', 'bg-pink-500',
]

// -- Helpers --

function normalizeDownload(s: ServerHealth): NormalizedServer {
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

function normalizeUpload(s: UploadServerHealth): NormalizedServer {
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

function formatUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(2)} MB`
  return `${(bytes / 1e3).toFixed(1)} KB`
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return '\u2014'
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`
  return `${(bps / 1e6).toFixed(1)} Mbps`
}

function timeUntil(isoString: string): string {
  const target = new Date(isoString).getTime()
  const now = Date.now()
  const diffMs = target - now
  if (diffMs <= 0) return ''
  const totalSeconds = Math.ceil(diffMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

function statusColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'bg-emerald-900/50 text-emerald-400 border-emerald-800'
    case 'testing':
      return 'bg-amber-900/50 text-amber-400 border-amber-800'
    case 'cooldown':
      return 'bg-amber-900/50 text-amber-400 border-amber-800'
    case 'failed':
      return 'bg-red-900/50 text-red-400 border-red-800'
    case 'blocked':
      return 'bg-red-900/50 text-red-400 border-red-800'
    default:
      return 'bg-forge-raised text-zinc-400 border-forge-border-strong'
  }
}

function rowBg(index: number): string {
  return index % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.01]'
}

// -- Grouping logic --

function buildProviderSections(servers: NormalizedServer[]): ProviderSection[] {
  const groupMap = new Map<string, NormalizedServer[]>()

  for (const s of servers) {
    const provider = extractProvider(s.url)
    const list = groupMap.get(provider) || []
    list.push(s)
    groupMap.set(provider, list)
  }

  // Assign colors stably by provider name sorted alphabetically
  const providerNames = Array.from(groupMap.keys()).sort()
  const colorMap = new Map<string, string>()
  providerNames.forEach((name, i) => {
    colorMap.set(name, PROVIDER_DOT_COLORS[i % PROVIDER_DOT_COLORS.length])
  })

  const sections: ProviderSection[] = []
  for (const [name, srvs] of groupMap) {
    const totalSpeed = srvs.reduce((sum, s) => sum + s.speedBps, 0)
    const healthyCount = srvs.filter(s => s.status === 'healthy' || s.status === 'testing').length
    sections.push({
      name,
      color: colorMap.get(name) || 'bg-zinc-500',
      servers: srvs,
      totalSpeed,
      healthyCount,
    })
  }

  // Sort: unhealthy providers (those with any non-healthy server) float to top,
  // then by total speed descending
  sections.sort((a, b) => {
    const aUnhealthy = a.servers.some(s => s.status === 'failed' || s.status === 'blocked' || s.status === 'cooldown')
    const bUnhealthy = b.servers.some(s => s.status === 'failed' || s.status === 'blocked' || s.status === 'cooldown')
    if (aUnhealthy !== bUnhealthy) return aUnhealthy ? -1 : 1
    return b.totalSpeed - a.totalSpeed
  })

  return sections
}

// -- Component --

export default function ProviderAccordion({ downloadServers, uploadServers, onUnblock }: ProviderAccordionProps) {
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(() => new Set())
  const [allExpanded, setAllExpanded] = useState(false)

  const normalized = useMemo(() => {
    if (downloadServers) return downloadServers.map(normalizeDownload)
    if (uploadServers) return uploadServers.map(normalizeUpload)
    return []
  }, [downloadServers, uploadServers])

  const sections = useMemo(() => buildProviderSections(normalized), [normalized])

  const toggleProvider = (name: string) => {
    setExpandedProviders(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedProviders(new Set())
      setAllExpanded(false)
    } else {
      setExpandedProviders(new Set(sections.map(s => s.name)))
      setAllExpanded(true)
    }
  }

  // Sync allExpanded state when individual toggles change
  const effectiveAllExpanded = sections.length > 0 && sections.every(s => expandedProviders.has(s.name))

  if (normalized.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <span className="text-sm text-zinc-500">No servers configured</span>
      </div>
    )
  }

  return (
    <div>
      {/* Expand All / Collapse All */}
      <div className="flex justify-end px-4 py-2 border-b border-white/[0.04]">
        <button
          onClick={toggleAll}
          className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider hover:text-zinc-400 transition-colors"
        >
          {effectiveAllExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* Provider sections */}
      <div className="divide-y divide-white/[0.04]">
        {sections.map(section => {
          const isExpanded = expandedProviders.has(section.name)

          return (
            <div key={section.name}>
              {/* Provider header */}
              <button
                onClick={() => toggleProvider(section.name)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
              >
                {isExpanded
                  ? <ChevronDown size={14} className="text-zinc-500 flex-shrink-0" />
                  : <ChevronRight size={14} className="text-zinc-600 flex-shrink-0" />
                }
                <span className={`w-2.5 h-2.5 rounded-full ${section.color} flex-shrink-0`} />
                <span className="text-sm font-semibold text-zinc-100">{section.name}</span>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs text-zinc-500">{section.servers.length} server{section.servers.length !== 1 ? 's' : ''}</span>
                  <span className="text-xs font-mono text-zinc-400">{formatSpeed(section.totalSpeed)}</span>
                  <span className={`text-xs font-bold font-mono ${section.healthyCount === section.servers.length ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {section.healthyCount}/{section.servers.length}
                  </span>
                </div>
              </button>

              {/* Expanded server table */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            <th className="px-4 py-2 pl-10 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Server</th>
                            <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Location</th>
                            <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Speed</th>
                            <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider text-center">Streams</th>
                            <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Transferred</th>
                            <th className="px-4 py-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.03]">
                          {section.servers
                            .slice()
                            .sort((a, b) => b.speedBps - a.speedBps)
                            .map((server, idx) => {
                              const cooldown = server.unhealthyUntil ? timeUntil(server.unhealthyUntil) : ''
                              return (
                                <tr key={server.url} className={`${rowBg(idx)} hover:bg-white/[0.02] transition-colors ${server.status === 'blocked' ? 'opacity-50' : ''}`}>
                                  <td className="px-4 py-2 pl-10 text-zinc-200 font-medium whitespace-nowrap text-xs">
                                    {formatUrl(server.url)}
                                  </td>
                                  <td className="px-4 py-2 text-zinc-500 whitespace-nowrap text-xs">
                                    {server.location || '\u2014'}
                                  </td>
                                  <td className="px-4 py-2 text-zinc-300 font-mono whitespace-nowrap text-xs">
                                    {formatSpeed(server.speedBps)}
                                  </td>
                                  <td className="px-4 py-2 text-zinc-400 text-center font-mono text-xs">
                                    {server.activeStreams}
                                  </td>
                                  <td className="px-4 py-2 text-zinc-500 font-mono whitespace-nowrap text-xs">
                                    {formatBytes(server.bytesTransferred)}
                                  </td>
                                  <td className="px-4 py-2 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusColor(server.status)}`}>
                                        {server.status === 'healthy' && <span className="w-1 h-1 rounded-full bg-emerald-400" />}
                                        {server.status === 'cooldown' && cooldown
                                          ? `${cooldown}`
                                          : server.status}
                                      </span>
                                      {server.status === 'blocked' && onUnblock && (
                                        <button
                                          onClick={() => onUnblock(server.url)}
                                          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                        >
                                          <Unlock size={10} />
                                          Unblock
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
