import { ServerHealth, UploadServerHealth } from '../api/client'

export interface ProviderGroup {
  name: string
  servers: number
  activeStreams: number
  totalSpeedBps: number
  totalBytes: number
  color: string
}

export const PROVIDER_PATTERNS: [RegExp, string][] = [
  [/hetzner\.(com|de)/, 'Hetzner'],
  [/vultr\.com/, 'Vultr'],
  [/leaseweb\.net/, 'Leaseweb'],
  [/ovh\.net/, 'OVH'],
  [/clouvider\.net/, 'Clouvider'],
  [/linode\.com/, 'Linode'],
  [/tele2\.net/, 'Tele2'],
  [/fdcservers\.net/, 'FDC'],
  [/belwue\.net/, 'BelWü'],
  [/online\.net/, 'Online.net'],
  [/serverius\.net/, 'Serverius'],
  [/worldstream\.nl/, 'Worldstream'],
  [/thinkbroadband\.com/, 'ThinkBroadband'],
  [/cloudflare\.com/, 'Cloudflare'],
  [/backblazeb2\.com/, 'Backblaze B2'],
  [/scaleway/, 'Scaleway'],
]

export const PROVIDER_COLORS = [
  '#f59e0b', '#ea580c', '#f97316', '#d97706', '#c2410c',
  '#fbbf24', '#fb923c', '#facc15', '#ef4444', '#dc2626',
  '#a16207', '#92400e', '#b45309', '#78350f', '#ca8a04', '#eab308',
]

export function extractProvider(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    for (const [pattern, name] of PROVIDER_PATTERNS) {
      if (pattern.test(hostname)) return name
    }
    const parts = hostname.split('.')
    if (parts.length >= 2) {
      return parts[parts.length - 2].charAt(0).toUpperCase() + parts[parts.length - 2].slice(1)
    }
    return hostname
  } catch {
    return 'Unknown'
  }
}

function groupServers(
  servers: { url: string; activeStreams: number; speedBps: number; bytes: number }[],
): ProviderGroup[] {
  const groups = new Map<string, { servers: number; streams: number; speed: number; bytes: number }>()

  for (const s of servers) {
    if (s.activeStreams <= 0 && s.speedBps <= 0) continue
    const provider = extractProvider(s.url)
    const existing = groups.get(provider) || { servers: 0, streams: 0, speed: 0, bytes: 0 }
    existing.servers++
    existing.streams += s.activeStreams
    existing.speed += s.speedBps
    existing.bytes += s.bytes
    groups.set(provider, existing)
  }

  const result: ProviderGroup[] = []
  let colorIdx = 0
  for (const [name, data] of groups) {
    result.push({
      name,
      servers: data.servers,
      activeStreams: data.streams,
      totalSpeedBps: data.speed,
      totalBytes: data.bytes,
      color: PROVIDER_COLORS[colorIdx % PROVIDER_COLORS.length],
    })
    colorIdx++
  }

  result.sort((a, b) => b.totalSpeedBps - a.totalSpeedBps)
  return result
}

export function groupDownloadServers(servers: ServerHealth[]): ProviderGroup[] {
  return groupServers(servers.map(s => ({
    url: s.url,
    activeStreams: s.activeStreams,
    speedBps: s.speedBps,
    bytes: s.bytesDownloaded,
  })))
}

export function groupUploadServers(servers: UploadServerHealth[]): ProviderGroup[] {
  return groupServers(servers.map(s => ({
    url: s.url,
    activeStreams: s.activeStreams,
    speedBps: s.speedBps,
    bytes: s.bytesUploaded,
  })))
}
