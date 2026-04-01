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
      <h2 className="text-2xl font-bold text-white">Updates</h2>

      {/* Docker status warning */}
      {status && !status.dockerAvailable && (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4">
          <p className="text-yellow-400 text-sm font-medium">Docker socket not available</p>
          <p className="text-yellow-500 text-xs mt-1">
            Auto-updates require mounting <code className="bg-yellow-900/50 px-1 rounded">/var/run/docker.sock</code> into the container. Check your docker-compose.yml volumes.
          </p>
        </div>
      )}

      {/* Current version + check */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Current Version</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <span className="text-sm text-gray-400">Version</span>
            <p className="text-sm font-semibold text-white mt-1">
              {status?.currentVersion && status.currentVersion !== 'dev'
                ? status.currentVersion
                : status?.currentDigest || 'Unknown'}
            </p>
          </div>
          <div>
            <span className="text-sm text-gray-400">Built</span>
            <p className="text-sm text-white mt-1">
              {status?.currentBuildDate && status.currentBuildDate !== 'unknown'
                ? new Date(status.currentBuildDate).toLocaleDateString()
                : '—'}
            </p>
          </div>
          <div>
            <span className="text-sm text-gray-400">Last Checked</span>
            <p className="text-sm text-white mt-1">
              {formatTime(status?.lastCheckTime)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCheck}
            disabled={checking || !status?.dockerAvailable}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>

          {status?.updateAvailable && (
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {updating ? 'Updating...' : 'Update Now'}
            </button>
          )}
        </div>

        {message && (
          <p className={`text-sm mt-3 ${
            message.includes('available') ? 'text-blue-400' :
            message.includes('latest') ? 'text-green-400' :
            message.includes('restart') ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {message}
          </p>
        )}

        {status?.updateAvailable && (
          <div className="mt-3 bg-blue-900/20 border border-blue-800 rounded-lg p-3">
            <span className="text-sm text-blue-400 font-medium">New version available</span>
            {status.latestVersion && (
              <p className="text-sm text-blue-300 mt-1">Version {status.latestVersion}</p>
            )}
            {!status.latestVersion && status.latestDigest && (
              <p className="text-xs font-mono text-blue-300/60 mt-1">{status.latestDigest}</p>
            )}
          </div>
        )}
      </div>

      {/* Auto-update settings */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Auto-Update</h3>
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setAutoEnabled(!autoEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                autoEnabled ? 'bg-blue-600' : 'bg-gray-700'
              }`}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  autoEnabled ? 'translate-x-5' : ''
                }`}
              />
            </div>
            <span className="text-sm text-white">Enable automatic updates</span>
          </label>

          {autoEnabled && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Schedule</label>
              <select
                value={autoSchedule}
                onChange={(e) => setAutoSchedule(e.target.value)}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {savingAuto ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Update history */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Update History</h3>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">No updates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-800">
                  <th className="pb-2 font-medium">Time</th>
                  <th className="pb-2 font-medium">From</th>
                  <th className="pb-2 font-medium">To</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.id} className="border-b border-gray-800/50">
                    <td className="py-2 text-gray-300">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="py-2 font-mono text-xs text-gray-400">{e.previousDigest}</td>
                    <td className="py-2 font-mono text-xs text-gray-400">{e.newDigest}</td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        e.status === 'success'
                          ? 'bg-green-900/50 text-green-400'
                          : 'bg-red-900/50 text-red-400'
                      }`}>
                        {e.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-gray-500 max-w-48 truncate">{e.errorMessage}</td>
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
