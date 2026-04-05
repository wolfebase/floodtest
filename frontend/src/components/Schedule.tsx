import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Clock, Calendar, Plus, Edit3, Trash2, ArrowDown, ArrowUp,
  Power, CheckCircle, Loader2,
} from 'lucide-react'
import { api, Schedule } from '../api/client'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatDays(days: number[]): string {
  if (days.length === 7) return 'Every day'
  if (
    days.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => days.includes(d))
  ) {
    return 'Weekdays'
  }
  if (
    days.length === 2 &&
    days.includes(0) &&
    days.includes(6)
  ) {
    return 'Weekends'
  }
  return days
    .sort((a, b) => a - b)
    .map((d) => DAY_NAMES[d])
    .join(', ')
}

function formatSpeed(mbps: number): string {
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(1)} Gbps`
  }
  return `${mbps} Mbps`
}

const emptyForm: Schedule = {
  daysOfWeek: [],
  startTime: '09:00',
  endTime: '17:00',
  downloadMbps: 500,
  uploadMbps: 500,
  enabled: true,
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<Schedule>({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const loadSchedules = useCallback(async () => {
    try {
      const data = await api.getSchedules()
      setSchedules(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSchedules()
  }, [loadSchedules])

  const openAddForm = () => {
    setForm({ ...emptyForm })
    setEditingId(null)
    setShowForm(true)
  }

  const openEditForm = (schedule: Schedule) => {
    setForm({ ...schedule })
    setEditingId(schedule.id ?? null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
  }

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day],
    }))
  }

  const handleSave = async () => {
    if (form.daysOfWeek.length === 0) {
      alert('Please select at least one day.')
      return
    }
    setSaving(true)
    try {
      if (editingId !== null) {
        await api.updateSchedule({ ...form, id: editingId })
      } else {
        await api.createSchedule(form)
      }
      closeForm()
      await loadSchedules()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this schedule entry?')) return
    try {
      await api.deleteSchedule(id)
      await loadSchedules()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete schedule')
    }
  }

  const handleToggleEnabled = async (schedule: Schedule) => {
    try {
      await api.updateSchedule({ ...schedule, enabled: !schedule.enabled })
      await loadSchedules()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update schedule')
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <Loader2 size={24} className="text-cyan-400 animate-spin" />
        <p className="text-sm text-zinc-500">Loading schedules...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-40">
        <p className="text-red-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight">Schedule</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Automated bandwidth scheduling</p>
        </div>
        <button
          onClick={openAddForm}
          className="px-4 py-2 rounded-xl font-medium text-sm bg-cyan-500 hover:bg-cyan-400 text-zinc-950 transition-all duration-300 flex items-center gap-1.5"
        >
          <Plus size={16} strokeWidth={2.5} />
          <span>Add Schedule</span>
        </button>
      </motion.div>

      {/* Schedule form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ delay: 0.08 }}
            className="glass-card p-5 space-y-5"
          >
            {/* Form header */}
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <Clock size={14} className="text-cyan-400" />
              </div>
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                {editingId !== null ? 'Edit Schedule' : 'New Schedule'}
              </h3>
            </div>

            {/* Days of week */}
            <div>
              <label className="block text-sm text-zinc-400 mb-2.5">Days of Week</label>
              <div className="flex gap-2">
                {DAY_NAMES.map((name, i) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`w-11 h-11 rounded-lg text-sm font-medium transition-all duration-200 border ${
                      form.daysOfWeek.includes(i)
                        ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-400 shadow-sm shadow-cyan-500/10'
                        : 'glass-inset text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Time range */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">Start Time</label>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm((prev) => ({ ...prev, startTime: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl glass-inset text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1.5">End Time</label>
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm((prev) => ({ ...prev, endTime: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl glass-inset text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30 transition-all"
                />
              </div>
            </div>

            {/* Speed targets */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-sm text-zinc-400 mb-1.5">
                  <ArrowDown size={13} className="text-cyan-400" />
                  Download Speed (Mbps)
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.downloadMbps}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      downloadMbps: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="w-full px-3 py-2.5 rounded-xl glass-inset text-zinc-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30 transition-all"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-sm text-zinc-400 mb-1.5">
                  <ArrowUp size={13} className="text-amber-400" />
                  Upload Speed (Mbps)
                </label>
                <input
                  type="number"
                  min={1}
                  value={form.uploadMbps}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      uploadMbps: parseInt(e.target.value) || 0,
                    }))
                  }
                  className="w-full px-3 py-2.5 rounded-xl glass-inset text-zinc-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500/30 transition-all"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 rounded-xl font-medium text-sm bg-cyan-500 hover:bg-cyan-400 text-zinc-950 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <CheckCircle size={15} />
                <span>{saving ? 'Saving...' : 'Save Schedule'}</span>
              </button>
              <button
                onClick={closeForm}
                className="px-5 py-2.5 rounded-xl text-sm font-medium glass text-zinc-300 border border-forge-border-strong hover:text-zinc-100 hover:border-zinc-600 transition-all"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Schedule list or empty state */}
      {schedules.length === 0 && !showForm ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="glass-card p-12"
        >
          <div className="flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-xl bg-zinc-800/50 border border-forge-border flex items-center justify-center mb-4">
              <Calendar size={22} className="text-zinc-600" />
            </div>
            <p className="text-zinc-300 font-medium mb-1">No schedules configured</p>
            <p className="text-zinc-500 text-sm max-w-sm">
              Add a schedule to automatically adjust bandwidth targets at specific times and days.
            </p>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule, index) => (
            <motion.div
              key={schedule.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08 }}
              className={`glass-card card-hover overflow-hidden ${
                !schedule.enabled ? 'opacity-50' : ''
              }`}
            >
              {/* Left accent bar via inset element */}
              <div className="flex">
                <div className={`w-1 flex-shrink-0 ${
                  schedule.enabled ? 'bg-cyan-500' : 'bg-zinc-700'
                }`} />
                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      {/* Schedule name and time */}
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                          schedule.enabled
                            ? 'bg-cyan-500/10'
                            : 'bg-zinc-800'
                        }`}>
                          <Clock size={14} className={schedule.enabled ? 'text-cyan-400' : 'text-zinc-600'} />
                        </div>
                        <div>
                          <span className="text-zinc-100 font-medium">
                            {formatDays(schedule.daysOfWeek)}
                          </span>
                          <span className="text-zinc-500 text-sm ml-3">
                            {schedule.startTime} - {schedule.endTime}
                          </span>
                        </div>
                      </div>

                      {/* Speed targets */}
                      <div className="flex items-center gap-4 ml-10">
                        <div className="flex items-center gap-1.5">
                          <ArrowDown size={13} className="text-cyan-400" />
                          <span className="text-sm font-mono text-zinc-300 tabular-nums">
                            {formatSpeed(schedule.downloadMbps)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <ArrowUp size={13} className="text-amber-400" />
                          <span className="text-sm font-mono text-zinc-400 tabular-nums">
                            {formatSpeed(schedule.uploadMbps)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5">
                      {/* Enable/Disable toggle */}
                      <button
                        onClick={() => handleToggleEnabled(schedule)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          schedule.enabled ? 'bg-cyan-500' : 'bg-zinc-700'
                        }`}
                        title={schedule.enabled ? 'Disable' : 'Enable'}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                            schedule.enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>

                      <button
                        onClick={() => openEditForm(schedule)}
                        className="p-2 rounded-lg text-zinc-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all"
                        title="Edit"
                      >
                        <Edit3 size={15} />
                      </button>
                      <button
                        onClick={() => schedule.id !== undefined && handleDelete(schedule.id)}
                        className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
