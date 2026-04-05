import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Clock, History, AlertTriangle, CheckCircle, Download, ArrowRight } from 'lucide-react'
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
    <div className="space-y-5 max-w-[1400px]">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0 }}
      >
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Updates</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Version management & auto-updates</p>
      </motion.div>

      {/* Docker status warning */}
      {status && !status.dockerAvailable && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3"
        >
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <AlertTriangle size={14} className="text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-400">Docker socket not available</p>
            <p className="text-xs text-amber-400/70 mt-1">
              Auto-updates require mounting <code className="px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/15 rounded text-amber-300 font-mono text-[11px]">/var/run/docker.sock</code> into the container. Check your docker-compose.yml volumes.
            </p>
          </div>
        </motion.div>
      )}

      {/* Current Version */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="glass-card card-hover p-5"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <RefreshCw size={14} className="text-indigo-400" />
            </div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Current Version</h3>
          </div>
          {status && (
            status.updateAvailable ? (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                Update Available
              </span>
            ) : (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                Up to Date
              </span>
            )
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          <div>
            <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">Version</div>
            <div className="text-sm font-mono text-zinc-200 truncate">
              {status?.currentVersion && status.currentVersion !== 'dev'
                ? status.currentVersion
                : 'dev'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">Build Date</div>
            <div className="text-sm font-mono text-zinc-300">
              {status?.currentBuildDate && status.currentBuildDate !== 'unknown'
                ? new Date(status.currentBuildDate).toLocaleDateString()
                : '\u2014'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">Digest</div>
            <div className="text-sm font-mono text-zinc-400 truncate" title={status?.currentDigest}>
              {status?.currentDigest
                ? (status.currentDigest.startsWith('sha256:')
                    ? status.currentDigest.slice(7, 19)
                    : status.currentDigest.slice(0, 12))
                : '\u2014'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1">Last Checked</div>
            <div className="text-sm font-mono text-zinc-300">
              {formatTime(status?.lastCheckTime)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCheck}
            disabled={checking || !status?.dockerAvailable}
            className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 text-sm font-semibold rounded-lg transition-all disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>

          {status?.updateAvailable && (
            <button
              onClick={handleUpdate}
              disabled={updating}
              className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-zinc-950 text-sm font-semibold rounded-lg transition-all disabled:opacity-50 disabled:hover:from-emerald-500 disabled:hover:to-emerald-600 flex items-center gap-2"
            >
              <Download size={14} />
              {updating ? 'Updating...' : 'Update Now'}
            </button>
          )}
        </div>

        {message && (
          <p className={`text-sm mt-3 font-medium ${
            message.includes('available') ? 'text-amber-400' :
            message.includes('latest') ? 'text-emerald-400' :
            message.includes('restart') ? 'text-amber-400' :
            'text-red-400'
          }`}>
            {message}
          </p>
        )}

        {/* Available update callout */}
        {status?.updateAvailable && (
          <div className="mt-4 glass-inset rounded-xl p-4 border border-amber-500/20">
            <div className="flex items-center gap-2 mb-1">
              <ArrowRight size={14} className="text-amber-400" />
              <span className="text-sm text-amber-400 font-semibold">New version available</span>
            </div>
            {status.latestVersion && (
              <p className="text-sm font-mono text-amber-300/80 ml-[22px]">
                {status.latestVersion}
              </p>
            )}
            {!status.latestVersion && status.latestDigest && (
              <p className="text-xs font-mono text-amber-300/50 ml-[22px] truncate" title={status.latestDigest}>
                {status.latestDigest}
              </p>
            )}
          </div>
        )}
      </motion.div>

      {/* Auto-Update settings */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="glass-card card-hover p-5"
      >
        <div className="flex items-center gap-2 mb-5">
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <Clock size={14} className="text-cyan-400" />
          </div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Auto-Update</h3>
        </div>

        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => setAutoEnabled(!autoEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                autoEnabled ? 'bg-cyan-500' : 'bg-zinc-700'
              }`}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                  autoEnabled ? 'translate-x-5' : ''
                }`}
              />
            </div>
            <div>
              <span className="text-sm text-zinc-200 font-medium">Enable automatic updates</span>
              <p className="text-xs text-zinc-500 mt-0.5">Automatically check and install new versions</p>
            </div>
          </label>

          {autoEnabled && (
            <div>
              <label className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1.5 block">Schedule</label>
              <select
                value={autoSchedule}
                onChange={(e) => setAutoSchedule(e.target.value)}
                className="px-3 py-2 glass-inset rounded-xl text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30"
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
            className="px-4 py-2 glass hover:bg-white/[0.06] text-zinc-200 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {savingAuto ? 'Saving...' : 'Save'}
          </button>
        </div>
      </motion.div>

      {/* Update History */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24 }}
        className="glass-card card-hover p-5"
      >
        <div className="flex items-center gap-2 mb-5">
          <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <History size={14} className="text-violet-400" />
          </div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Update History</h3>
        </div>

        {history.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-10 h-10 rounded-xl bg-zinc-800/50 flex items-center justify-center mx-auto mb-3">
              <History size={18} className="text-zinc-600" />
            </div>
            <p className="text-sm text-zinc-500">No updates yet</p>
            <p className="text-xs text-zinc-600 mt-1">Update history will appear here after the first update</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="pb-2.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider text-left">Time</th>
                  <th className="pb-2.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider text-left">From</th>
                  <th className="pb-2.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider text-left">To</th>
                  <th className="pb-2.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider text-left">Status</th>
                  <th className="pb-2.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                {history.map((e, i) => (
                  <motion.tr
                    key={e.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-2.5 text-xs text-zinc-300">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="py-2.5">
                      <span className="font-mono text-xs text-zinc-500 glass-inset px-1.5 py-0.5 rounded" title={e.previousDigest}>
                        {e.previousDigest?.startsWith('sha256:') ? e.previousDigest.slice(7, 19) : e.previousDigest?.slice(0, 12) || '\u2014'}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span className="font-mono text-xs text-zinc-500 glass-inset px-1.5 py-0.5 rounded" title={e.newDigest}>
                        {e.newDigest?.startsWith('sha256:') ? e.newDigest.slice(7, 19) : e.newDigest?.slice(0, 12) || '\u2014'}
                      </span>
                    </td>
                    <td className="py-2.5">
                      {e.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                          <CheckCircle size={10} />
                          Success
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                          <AlertTriangle size={10} />
                          Failed
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-zinc-600 max-w-48 truncate">{e.errorMessage}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  )
}
