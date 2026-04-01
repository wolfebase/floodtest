const BASE = ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json()
}

export interface Status {
  running: boolean
  downloadBps: number
  uploadBps: number
  downloadStreams: number
  uploadStreams: number
  uptimeSeconds: number
  overrideState: number
  targetDownloadMbps: number
  targetUploadMbps: number
}

export interface HistoryPoint {
  timestamp: string
  downloadBps: number
  uploadBps: number
}

export interface UsageCounters {
  session: { downloadBytes: number; uploadBytes: number }
  today: { downloadBytes: number; uploadBytes: number }
  month: { downloadBytes: number; uploadBytes: number }
  allTime: { downloadBytes: number; uploadBytes: number }
}

export interface ThrottleEvent {
  id: number
  timestamp: string
  direction: string
  targetBps: number
  actualBps: number
  durationSeconds: number
  resolvedAt: string | null
}

export interface Schedule {
  id?: number
  daysOfWeek: number[]
  startTime: string
  endTime: string
  downloadMbps: number
  uploadMbps: number
  enabled: boolean
}

export interface Settings {
  b2KeyId: string
  b2AppKey: string
  b2BucketName: string
  b2Endpoint: string
  defaultDownloadMbps: number
  defaultUploadMbps: number
  downloadConcurrency: number
  uploadConcurrency: number
  uploadChunkSizeMb: number
  throttleThresholdPct: number
  throttleWindowMin: number
  downloadServers: string[]
  uploadMode: string
  uploadEndpoints: string[]
}

export interface ServerHealth {
  url: string
  location: string
  healthy: boolean
  consecutiveFailures: number
  totalFailures: number
  totalDownloads: number
  lastError?: string
  lastErrorTime?: string
  unhealthyUntil?: string
  bytesDownloaded: number
  speedBps: number
  activeStreams: number
  status: string
}

export interface SpeedTestResult {
  url: string
  location: string
  speedBps: number
  error?: string
  ok: boolean
}

export interface UploadServerHealth {
  url: string
  healthy: boolean
  consecutiveFailures: number
  totalFailures: number
  totalUploads: number
  lastError?: string
  lastErrorTime?: string
  unhealthyUntil?: string
  bytesUploaded: number
  activeStreams: number
  status: string
}

export interface UpdateStatus {
  currentDigest: string
  latestDigest?: string
  updateAvailable: boolean
  lastCheckTime?: string
  lastUpdateTime?: string
  autoUpdateEnabled: boolean
  autoUpdateSchedule: string
  checking: boolean
  updating: boolean
  dockerAvailable: boolean
}

export interface UpdateHistoryEntry {
  id: number
  previousDigest: string
  newDigest: string
  status: string
  errorMessage?: string
  createdAt: string
}

export const api = {
  getStatus: () => request<Status>('/api/status'),
  start: (downloadMbps?: number, uploadMbps?: number) =>
    request<void>('/api/start', {
      method: 'POST',
      body: JSON.stringify({ downloadMbps, uploadMbps }),
    }),
  stop: () => request<void>('/api/stop', { method: 'POST' }),

  getHistory: (range: string) =>
    request<HistoryPoint[]>(`/api/history?range=${range}`),
  getUsage: () => request<UsageCounters>('/api/usage'),
  getThrottleEvents: () => request<ThrottleEvent[]>('/api/throttle-events'),

  getSchedules: () => request<Schedule[]>('/api/schedules'),
  createSchedule: (s: Schedule) =>
    request<{ id: number }>('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(s),
    }),
  updateSchedule: (s: Schedule) =>
    request<void>(`/api/schedules/${s.id}`, {
      method: 'PUT',
      body: JSON.stringify(s),
    }),
  deleteSchedule: (id: number) =>
    request<void>(`/api/schedules/${id}`, { method: 'DELETE' }),

  getSettings: () => request<Settings>('/api/settings'),
  updateSettings: (s: Partial<Settings>) =>
    request<void>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(s),
    }),
  testB2: () => request<{ success: boolean; message: string }>('/api/settings/test-b2', { method: 'POST' }),
  isSetupRequired: () => request<{ required: boolean }>('/api/settings/setup-required'),
  getServerHealth: () => request<ServerHealth[]>('/api/server-health'),
  runSpeedTest: () => request<SpeedTestResult[]>('/api/speed-test', { method: 'POST' }),
  getUploadServerHealth: () => request<UploadServerHealth[]>('/api/upload-server-health'),

  // Updates
  getUpdateStatus: () => request<UpdateStatus>('/api/updates/status'),
  checkForUpdates: () => request<UpdateStatus>('/api/updates/check', { method: 'POST' }),
  applyUpdate: () => request<{ status: string }>('/api/updates/apply', { method: 'POST' }),
  setAutoUpdate: (enabled: boolean, schedule: string) =>
    request<void>('/api/updates/auto', {
      method: 'POST',
      body: JSON.stringify({ enabled, schedule }),
    }),
  getUpdateHistory: () => request<UpdateHistoryEntry[]>('/api/updates/history'),
}
