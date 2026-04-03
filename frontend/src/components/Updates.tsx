import { useState, useEffect } from 'react'
import { api, UpdateStatus, UpdateHistoryEntry } from '../api/client'

export default function UpdatesPage() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [history, setHistory] = useState<UpdateHistoryEntry[]>([])
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [autoSchedule, setAutoSchedule] = useState('weekly')
  const [savingAuto, setSavingAuto] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    loadStatus()
    loadHistory()
  }, [])

  const loadStatus = async () => {
    try {
      const s = await api.getUpdateStatus()
      setStatus(s)
      setAutoEnabled(s.autoUpdateEnabled)
      setAutoSchedule(s.autoUpdateSchedule || 'weekly')
    } catch {
      // ignore
    }
  }

  const loadHistory = async () => {
    try {
      const h = await api.getUpdateHistory()
      setHistory(h)
    } catch {
      // ignore
    }
  }

  const handleCheck = async () => {
    setChecking(true)
    setMessage('')
    try {
      const s = await api.checkForUpdates()
      setStatus(s)
      if (s.updateAvailable) {
        setMessage('Update available!')
      } else {
        setMessage('You are running the latest version.')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setChecking(false)
    }
  }

  const handleUpdate = async () => {
    if (!confirm('FloodTest will restart to apply the update. This takes about 30 seconds. Continue?')) {
      return
    }
    setUpdating(true)
    setMessage('')
    try {
      await api.applyUpdate()
      setMessage('Update started. FloodTest will restart shortly...')
      loadHistory()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed')
      setUpdating(false)
    }
  }

  const handleSaveAuto = async () => {
    setSavingAuto(true)
    try {
      await api.setAutoUpdate(autoEnabled, autoSchedule)
      setMessage('Auto-update settings saved.')
      loadStatus()
    } catch {
      setMessage('Failed to save settings.')
    } finally {
      setSavingAuto(false)
    }
  }

  const formatTime = (iso?: string) => {
    if (!iso) return 'Never'
    return new Date(iso).toLocaleString()
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-zinc-50">Updates</h2>

      {/* Docker status warning */}
      {status && !status.dockerAvailable && (
        <div className="bg-amber-950/30 border border-amber-800 rounded-lg p-4">
          <p className="text-amber-400 text-sm font-medium">Docker socket not available</p>
          <p className="text-amber-400 text-xs mt-1">
            Auto-updates require mounting <code className="bg-amber-900/50 px-1 rounded">/var/run/docker.sock</code> into the container. Check your docker-compose.yml volumes.
          </p>
        </div>
      )}

      {/* Current version + check */}
      <div className="bg-forge-surface rounded-lg border border-forge-border border-t-2 border-t-amber-500 p-4">
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">Current Version</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
          <div>
            <span className="text-sm text-zinc-400">Version</span>
            <p className="text-sm font-semibold text-zinc-50 mt-1">
              {status?.currentVersion && status.currentVersion !== 'dev'
                ? status.currentVersion
                : status?.currentDigest || 'Unknown'}
            </p>
          </div>
          <div>
            <span className="text-sm text-zinc-400">Built</span>
            <p className="text-sm text-zinc-50 mt-1">
              {status?.currentBuildDate && status.currentBuildDate !== 'unknown'
                ? new Date(status.currentBuildDate).toLocaleDateString()
                : '\u2014'}
            </p>
          </div>
          <div>
            <span className="text-sm text-zinc-400">Last Checked</span>
            <p className="text-sm text-zinc-50 mt-1">
              {formatTime(status?.lastCheckTime)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCheck}
            disabled={checking || !status?.dockerAvailable}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>

          {status?.updateAvailable && (
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-zinc-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {updating ? 'Updating...' : 'Update Now'}
            </button>
          )}
        </div>

        {message && (
          <p className={`text-sm mt-3 ${
            message.includes('available') ? 'text-amber-400' :
            message.includes('latest') ? 'text-emerald-400' :
            message.includes('restart') ? 'text-amber-400' :
            'text-red-400'
          }`}>
            {message}
          </p>
        )}

        {status?.updateAvailable && (
          <div className="mt-3 bg-amber-900/20 border border-amber-800 rounded-lg p-3">
            <span className="text-sm text-amber-400 font-medium">New version available</span>
            {status.latestVersion && (
              <p className="text-sm text-amber-300 mt-1">Version {status.latestVersion}</p>
            )}
            {!status.latestVersion && status.latestDigest && (
              <p className="text-xs font-mono text-amber-300/60 mt-1">{status.latestDigest}</p>
            )}
          </div>
        )}
      </div>

      {/* Auto-update settings */}
      <div className="bg-forge-surface rounded-lg border border-forge-border p-4">
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">Auto-Update</h3>
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setAutoEnabled(!autoEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                autoEnabled ? 'bg-amber-500' : 'bg-zinc-700'
              }`}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  autoEnabled ? 'translate-x-5' : ''
                }`}
              />
            </div>
            <span className="text-sm text-zinc-50">Enable automatic updates</span>
          </label>

          {autoEnabled && (
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Schedule</label>
              <select
                value={autoSchedule}
                onChange={(e) => setAutoSchedule(e.target.value)}
                className="px-3 py-2 bg-forge-raised border border-forge-border-strong rounded-lg text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="daily">Daily at 3:00 AM</option>
                <option value="weekly">Weekly — Sundays at 3:00 AM</option>
                <option value="monthly">Monthly — 1st at 3:00 AM</option>
              </select>
            </div>
          )}

          <button
            onClick={handleSaveAuto}
            disabled={savingAuto}
            className="px-4 py-2 bg-forge-raised hover:bg-forge-border-strong text-zinc-50 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {savingAuto ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Update history */}
      <div className="bg-forge-surface rounded-lg border border-forge-border p-4">
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">Update History</h3>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">No updates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-zinc-400 text-left border-b border-forge-border">
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">From</th>
                  <th className="pb-2 font-medium">To</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.id} className="border-b border-forge-border/50">
                    <td className="py-2 text-zinc-300">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="py-2">
                      <span className="font-mono text-xs text-zinc-400" title={e.previousDigest}>
                        {e.previousDigest?.startsWith('sha256:') ? e.previousDigest.slice(7, 15) : e.previousDigest?.slice(0, 8) || '\u2014'}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className="font-mono text-xs text-zinc-400" title={e.newDigest}>
                        {e.newDigest?.startsWith('sha256:') ? e.newDigest.slice(7, 15) : e.newDigest?.slice(0, 8) || '\u2014'}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        e.status === 'success'
                          ? 'bg-emerald-900/50 text-emerald-400'
                          : 'bg-red-900/50 text-red-400'
                      }`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-zinc-500 max-w-48 truncate">{e.errorMessage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
