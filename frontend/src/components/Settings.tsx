import { useState, useEffect } from 'react'
import { api, Settings as SettingsType } from '../api/client'

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [newServerUrl, setNewServerUrl] = useState('')
  const [newUploadEndpoint, setNewUploadEndpoint] = useState('')

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setSettings(s)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const update = (partial: Partial<SettingsType>) => {
    if (!settings) return
    setSettings({ ...settings, ...partial })
  }

  const handleTestConnection = async () => {
    setTestStatus('testing')
    setTestMessage('')
    try {
      // Save current B2 settings before testing
      if (settings) {
        await api.updateSettings({
          b2KeyId: settings.b2KeyId,
          b2AppKey: settings.b2AppKey,
          b2BucketName: settings.b2BucketName,
          b2Endpoint: settings.b2Endpoint,
        })
      }
      const result = await api.testB2()
      if (result.success) {
        setTestStatus('success')
        setTestMessage(result.message || 'Connection successful')
      } else {
        setTestStatus('error')
        setTestMessage(result.message || 'Connection failed')
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    setSaveMessage('')
    try {
      await api.updateSettings(settings)
      setSaveMessage('Settings saved successfully')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (err) {
      setSaveMessage(
        `Error: ${err instanceof Error ? err.message : 'Failed to save'}`
      )
    } finally {
      setSaving(false)
    }
  }

  const addServer = () => {
    if (!settings || !newServerUrl.trim()) return
    update({
      downloadServers: [...settings.downloadServers, newServerUrl.trim()],
    })
    setNewServerUrl('')
  }

  const removeServer = (index: number) => {
    if (!settings) return
    update({
      downloadServers: settings.downloadServers.filter((_, i) => i !== index),
    })
  }

  const addUploadEndpoint = () => {
    if (!settings || !newUploadEndpoint.trim()) return
    update({ uploadEndpoints: [...settings.uploadEndpoints, newUploadEndpoint.trim()] })
    setNewUploadEndpoint('')
  }

  const removeUploadEndpoint = (index: number) => {
    if (!settings) return
    update({ uploadEndpoints: settings.uploadEndpoints.filter((_, i) => i !== index) })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-zinc-400">Loading settings...</span>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-red-400">Failed to load settings</span>
      </div>
    )
  }

  const inputClass =
    'w-full px-3 py-2 bg-forge-raised border border-forge-border-strong rounded-lg text-zinc-50 text-sm placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent'
  const labelClass = 'block text-sm font-medium text-zinc-300 mb-1'
  const sectionClass = 'bg-forge-surface rounded-lg border border-forge-border p-4'

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-zinc-50">Settings</h2>

      {/* Upload Configuration */}
      <div className={sectionClass}>
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">
          Upload Configuration
        </h3>

        {/* Upload Mode selector */}
        <div className="mb-4">
          <label className={labelClass}>Upload Mode</label>
          <select
            value={settings.uploadMode}
            onChange={(e) => update({ uploadMode: e.target.value })}
            className="w-full px-3 py-2 bg-forge-raised border border-forge-border-strong rounded-lg text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          >
            <option value="http">HTTP Discard (Free — no account needed)</option>
            <option value="s3">S3-Compatible (Backblaze B2 / Cloudflare R2)</option>
            <option value="local">Local Discard (testing only)</option>
          </select>
          <p className="text-xs text-zinc-500 mt-1">
            {settings.uploadMode === 'http' && 'Uploads random data to HTTP discard endpoints. No account required — measures real WAN upload throughput.'}
            {settings.uploadMode === 's3' && 'Uploads to an S3-compatible bucket (e.g. Backblaze B2, Cloudflare R2). Requires credentials below.'}
            {settings.uploadMode === 'local' && 'Uploads to this app\'s built-in discard endpoint. Does not measure real WAN bandwidth.'}
          </p>
        </div>

        {/* S3 mode: B2 credential fields */}
        {settings.uploadMode === 's3' && (
          <div className="mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Key ID</label>
                <input
                  type="text"
                  value={settings.b2KeyId}
                  onChange={(e) => update({ b2KeyId: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Application Key</label>
                <input
                  type="password"
                  value={settings.b2AppKey}
                  onChange={(e) => update({ b2AppKey: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Bucket Name</label>
                <input
                  type="text"
                  value={settings.b2BucketName}
                  onChange={(e) => update({ b2BucketName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>S3 Endpoint</label>
                <p className="text-xs text-zinc-500 mb-2">Must match your B2 account. Check your B2 dashboard → Buckets → Endpoint column.</p>
                {(() => {
                  const knownEndpoints = [
                    'https://s3.us-west-000.backblazeb2.com',
                    'https://s3.us-west-001.backblazeb2.com',
                    'https://s3.us-west-002.backblazeb2.com',
                    'https://s3.us-west-004.backblazeb2.com',
                    'https://s3.us-east-005.backblazeb2.com',
                  ]
                  const isKnown = knownEndpoints.includes(settings.b2Endpoint)
                  return (
                    <div className="space-y-2">
                      <select
                        value={isKnown ? settings.b2Endpoint : '__custom__'}
                        onChange={(e) => {
                          if (e.target.value !== '__custom__') {
                            update({ b2Endpoint: e.target.value })
                          } else {
                            update({ b2Endpoint: '' })
                          }
                        }}
                        className="w-full px-3 py-2 bg-forge-raised border border-forge-border-strong rounded-lg text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      >
                        <option value="https://s3.us-west-000.backblazeb2.com">us-west-000 — s3.us-west-000.backblazeb2.com</option>
                        <option value="https://s3.us-west-001.backblazeb2.com">us-west-001 — s3.us-west-001.backblazeb2.com</option>
                        <option value="https://s3.us-west-002.backblazeb2.com">us-west-002 — s3.us-west-002.backblazeb2.com</option>
                        <option value="https://s3.us-west-004.backblazeb2.com">us-west-004 — s3.us-west-004.backblazeb2.com</option>
                        <option value="https://s3.us-east-005.backblazeb2.com">us-east-005 — s3.us-east-005.backblazeb2.com</option>
                        <option value="__custom__">Custom endpoint...</option>
                      </select>
                      {!isKnown && (
                        <input
                          type="text"
                          value={settings.b2Endpoint}
                          onChange={(e) => update({ b2Endpoint: e.target.value })}
                          placeholder="https://s3.xx-xxxx-xxx.backblazeb2.com"
                          className={inputClass}
                        />
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleTestConnection}
                disabled={testStatus === 'testing'}
                className="px-4 py-2 border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 bg-transparent text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
              </button>
              {testStatus === 'success' && (
                <span className="text-sm text-emerald-400">{testMessage}</span>
              )}
              {testStatus === 'error' && (
                <span className="text-sm text-red-400">{testMessage}</span>
              )}
            </div>
          </div>
        )}

        {/* HTTP mode: upload endpoints list */}
        {settings.uploadMode === 'http' && (
          <div className="mb-4">
            <label className={labelClass}>Upload Endpoints</label>
            <div className="space-y-2 mb-4">
              {settings.uploadEndpoints.length === 0 && (
                <p className="text-sm text-zinc-500">No upload endpoints configured</p>
              )}
              {settings.uploadEndpoints.map((url, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 bg-forge-raised rounded-lg px-3 py-2"
                >
                  <span className="flex-1 text-sm text-zinc-50 font-mono truncate">
                    {url}
                  </span>
                  <button
                    onClick={() => removeUploadEndpoint(index)}
                    className="text-red-400 hover:text-red-300 text-sm font-medium shrink-0"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newUploadEndpoint}
                onChange={(e) => setNewUploadEndpoint(e.target.value)}
                placeholder="https://example.com/upload"
                className={inputClass}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addUploadEndpoint()
                }}
              />
              <button
                onClick={addUploadEndpoint}
                disabled={!newUploadEndpoint.trim()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 shrink-0"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Local mode: info box */}
        {settings.uploadMode === 'local' && (
          <div className="mb-4 bg-forge-raised border border-forge-border-strong rounded-lg p-4">
            <p className="text-sm text-zinc-300">
              Uploads to this app's built-in discard endpoint. Does not test real WAN upload bandwidth — only useful for testing the upload engine itself.
            </p>
          </div>
        )}

        {/* Chunk Size — shown for all modes */}
        <div className="max-w-xs">
          <label className={labelClass}>Chunk Size (MB)</label>
          <input
            type="number"
            value={settings.uploadChunkSizeMb}
            onChange={(e) =>
              update({ uploadChunkSizeMb: Number(e.target.value) })
            }
            min={1}
            className={inputClass}
          />
        </div>
      </div>

      {/* Speed Targets */}
      <div className={sectionClass}>
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">Speed Targets</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Download (Mbps)</label>
            <input
              type="number"
              value={settings.defaultDownloadMbps}
              onChange={(e) =>
                update({ defaultDownloadMbps: Number(e.target.value) })
              }
              min={1}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div>
            <label className={labelClass}>Upload (Mbps)</label>
            <input
              type="number"
              value={settings.defaultUploadMbps}
              onChange={(e) =>
                update({ defaultUploadMbps: Number(e.target.value) })
              }
              min={1}
              className={`${inputClass} font-mono`}
            />
          </div>
        </div>
      </div>

      {/* Concurrency */}
      <div className={sectionClass}>
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">Concurrency</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Download Streams</label>
            <input
              type="number"
              value={settings.downloadConcurrency}
              onChange={(e) =>
                update({ downloadConcurrency: Number(e.target.value) })
              }
              min={1}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Upload Streams</label>
            <input
              type="number"
              value={settings.uploadConcurrency}
              onChange={(e) =>
                update({ uploadConcurrency: Number(e.target.value) })
              }
              min={1}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Download Servers */}
      <div className={sectionClass}>
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">
          Download Servers
        </h3>
        <div className="space-y-2 mb-4">
          {settings.downloadServers.length === 0 && (
            <p className="text-sm text-zinc-500">No download servers configured</p>
          )}
          {settings.downloadServers.map((url, index) => (
            <div
              key={index}
              className="flex items-center gap-2 bg-forge-raised rounded-lg px-3 py-2"
            >
              <span className="flex-1 text-sm text-zinc-50 font-mono truncate">
                {url}
              </span>
              <button
                onClick={() => removeServer(index)}
                className="text-red-400 hover:text-red-300 text-sm font-medium shrink-0"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newServerUrl}
            onChange={(e) => setNewServerUrl(e.target.value)}
            placeholder="https://example.com/testfile"
            className={inputClass}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addServer()
            }}
          />
          <button
            onClick={addServer}
            disabled={!newServerUrl.trim()}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 shrink-0"
          >
            Add
          </button>
        </div>
      </div>

      {/* Throttle Detection */}
      <div className={sectionClass}>
        <h3 className="text-lg font-semibold text-zinc-50 mb-4">
          Throttle Detection
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Threshold (%)</label>
            <input
              type="number"
              value={settings.throttleThresholdPct}
              onChange={(e) =>
                update({ throttleThresholdPct: Number(e.target.value) })
              }
              min={1}
              max={100}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Detection Window (minutes)</label>
            <input
              type="number"
              value={settings.throttleWindowMin}
              onChange={(e) =>
                update({ throttleWindowMin: Number(e.target.value) })
              }
              min={1}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-zinc-950 font-semibold text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {saveMessage && (
          <span
            className={`text-sm ${
              saveMessage.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {saveMessage}
          </span>
        )}
      </div>
    </div>
  )
}
