import { useState } from 'react'
import { api } from '../api/client'

interface SetupWizardProps {
  onComplete: () => void
}

// B2 assigns each account to a specific cluster. The user MUST use the endpoint
// that matches their account — it's not a preference. The simplest UX is to let
// them paste their endpoint or pick from the known list.
const B2_ENDPOINTS = [
  { id: 'us-west-000', url: 'https://s3.us-west-000.backblazeb2.com' },
  { id: 'us-west-001', url: 'https://s3.us-west-001.backblazeb2.com' },
  { id: 'us-west-002', url: 'https://s3.us-west-002.backblazeb2.com' },
  { id: 'us-west-004', url: 'https://s3.us-west-004.backblazeb2.com' },
  { id: 'us-east-005', url: 'https://s3.us-east-005.backblazeb2.com' },
] as const

const SPEED_PRESETS = [
  { label: '1 Gbps', mbps: 1000 },
  { label: '2.5 Gbps', mbps: 2500 },
  { label: '5 Gbps', mbps: 5000 },
  { label: '10 Gbps', mbps: 10000 },
]

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(0) // 0 = welcome, 1-3 = wizard steps

  // Step 1: B2 Credentials
  const [b2KeyId, setB2KeyId] = useState('')
  const [b2AppKey, setB2AppKey] = useState('')
  const [b2BucketName, setB2BucketName] = useState('')
  const [b2Endpoint, setB2Endpoint] = useState('https://s3.us-west-002.backblazeb2.com')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState('')

  // Step 2: Speed Targets
  const [downloadMbps, setDownloadMbps] = useState(5000)
  const [uploadMbps, setUploadMbps] = useState(5000)

  // Step 3
  const [saving, setSaving] = useState(false)

  const handleTestConnection = async () => {
    setTestStatus('testing')
    setTestMessage('')
    try {
      await api.updateSettings({
        b2KeyId,
        b2AppKey,
        b2BucketName,
        b2Endpoint: b2Endpoint,
      })
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
    setSaving(true)
    try {
      await api.updateSettings({
        b2KeyId,
        b2AppKey,
        b2BucketName,
        b2Endpoint: b2Endpoint,
        defaultDownloadMbps: downloadMbps,
        defaultUploadMbps: uploadMbps,
      })
      onComplete()
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full px-3 py-2 bg-forge-raised border border-forge-border-strong rounded-lg text-zinc-50 text-sm placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent'
  const labelClass = 'block text-sm font-medium text-zinc-300 mb-1'

  return (
    <div className="min-h-screen bg-forge-base flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Step indicators (hidden on welcome screen) */}
        {step >= 1 && (
          <div className="flex items-center justify-center gap-3 mb-8">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                    s === step
                      ? 'bg-amber-500 text-zinc-950'
                      : s < step
                      ? 'bg-emerald-600 text-zinc-50'
                      : 'bg-forge-raised text-zinc-500 border border-forge-border-strong'
                  }`}
                >
                  {s < step ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    s
                  )}
                </div>
                {s < 3 && (
                  <div
                    className={`w-12 h-0.5 ${
                      s < step ? 'bg-emerald-600' : 'bg-forge-raised'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Card */}
        <div className="bg-forge-surface rounded-lg border border-forge-border p-4">
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="space-y-6 text-center">
              {/* Wave/signal icon */}
              <div className="flex justify-center">
                <svg
                  className="w-16 h-16 text-amber-500"
                  viewBox="0 0 64 64"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M4 40c4-8 8-16 12-6s8 14 12 4 8-18 12-8 8 14 12 4 8-12 8-12"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M4 32c4-6 8-12 12-4s8 10 12 2 8-14 12-6 8 10 12 2 8-8 8-8"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.4"
                  />
                </svg>
              </div>

              <div>
                <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">FloodTest</h1>
                <p className="text-amber-400 text-sm font-medium mt-1">ISP Throttle Detection Tool</p>
              </div>

              <p className="text-zinc-400 text-sm leading-relaxed text-left">
                FloodTest saturates your WAN connection in both directions — downloading from
                public speed test servers and uploading to Backblaze B2 cloud storage — to detect
                if your ISP throttles your connection after sustained heavy usage. All traffic is
                real WAN traffic that registers on your ISP's meter.
              </p>

              <button
                onClick={() => setStep(1)}
                className="w-full px-5 py-3 bg-amber-500 hover:bg-amber-600 text-zinc-950 text-sm font-semibold rounded-lg transition-colors"
              >
                Get Started
              </button>
            </div>
          )}

          {/* Step 1: Upload Storage (B2 Credentials) */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-zinc-50">Upload Storage</h2>
              <p className="text-sm text-zinc-400">
                FloodTest needs somewhere to upload data. We use Backblaze B2 because ingress is
                free and unlimited. Each uploaded object is deleted immediately — your storage
                stays at ~0.
              </p>
              <p className="text-xs text-zinc-500">
                Don't have a B2 account?{' '}
                <a
                  href="https://www.backblaze.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 hover:text-amber-300 underline"
                >
                  It's free at backblaze.com
                </a>
              </p>

              <div>
                <label className={labelClass}>Key ID</label>
                <input
                  type="text"
                  value={b2KeyId}
                  onChange={(e) => setB2KeyId(e.target.value)}
                  placeholder="Your B2 Key ID"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Application Key</label>
                <input
                  type="password"
                  value={b2AppKey}
                  onChange={(e) => setB2AppKey(e.target.value)}
                  placeholder="Your B2 Application Key"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Bucket Name</label>
                <input
                  type="text"
                  value={b2BucketName}
                  onChange={(e) => setB2BucketName(e.target.value)}
                  placeholder="my-bucket"
                  className={inputClass}
                />
              </div>

              {/* B2 Endpoint */}
              <div>
                <label className={labelClass}>S3 Endpoint</label>
                <p className="text-xs text-zinc-500 mb-2">
                  This must match your B2 account. In your{' '}
                  <a href="https://secure.backblaze.com/b2_buckets.htm" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:text-amber-300 underline">B2 dashboard</a>
                  , go to Buckets and copy the "Endpoint" value — or select from the list below.
                </p>
                <select
                  value={B2_ENDPOINTS.some(e => e.url === b2Endpoint) ? b2Endpoint : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      setB2Endpoint(e.target.value)
                    } else {
                      setB2Endpoint('')
                    }
                  }}
                  className="w-full px-3 py-2 bg-forge-raised border border-forge-border-strong rounded-lg text-zinc-50 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent mb-2"
                >
                  {B2_ENDPOINTS.map((ep) => (
                    <option key={ep.id} value={ep.url}>{ep.id} — {ep.url.replace('https://', '')}</option>
                  ))}
                  <option value="__custom__">Custom endpoint...</option>
                </select>
                {!B2_ENDPOINTS.some(e => e.url === b2Endpoint) && (
                  <input
                    type="text"
                    value={b2Endpoint}
                    onChange={(e) => setB2Endpoint(e.target.value)}
                    placeholder="https://s3.xx-xxxx-xxx.backblazeb2.com"
                    className={inputClass}
                  />
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestConnection}
                  disabled={
                    !b2KeyId ||
                    !b2AppKey ||
                    !b2BucketName ||
                    !b2Endpoint ||
                    testStatus === 'testing'
                  }
                  className="px-4 py-2 border border-amber-500/50 text-amber-400 hover:bg-amber-500/10 bg-transparent text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setStep(2)}
                  disabled={testStatus !== 'success'}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Speed Targets */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-zinc-50">Speed Targets</h2>
              <p className="text-sm text-zinc-400">
                Set the bandwidth target for each direction. FloodTest will try to sustain this
                speed. Set these to your ISP's advertised speed or slightly below.
              </p>

              {/* Speed presets */}
              <div>
                <label className={labelClass}>Quick Presets</label>
                <div className="grid grid-cols-4 gap-2">
                  {SPEED_PRESETS.map((preset) => (
                    <button
                      key={preset.mbps}
                      onClick={() => {
                        setDownloadMbps(preset.mbps)
                        setUploadMbps(preset.mbps)
                      }}
                      className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                        downloadMbps === preset.mbps && uploadMbps === preset.mbps
                          ? 'border-amber-500 bg-amber-500 text-zinc-950'
                          : 'border-forge-border-strong bg-forge-raised text-zinc-300 hover:border-zinc-600'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>Download Target (Mbps)</label>
                <input
                  type="number"
                  value={downloadMbps}
                  onChange={(e) => setDownloadMbps(Number(e.target.value))}
                  min={1}
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div>
                <label className={labelClass}>Upload Target (Mbps)</label>
                <input
                  type="number"
                  value={uploadMbps}
                  onChange={(e) => setUploadMbps(Number(e.target.value))}
                  min={1}
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="px-5 py-2 bg-forge-raised hover:bg-forge-border-strong text-zinc-50 text-sm font-medium rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-zinc-950 text-sm font-medium rounded-lg transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Summary */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-zinc-50">You're All Set</h2>
              <p className="text-sm text-zinc-400">
                Review your configuration before launching.
              </p>

              <div className="bg-forge-raised rounded-lg p-4 space-y-3 text-sm">
                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Upload Storage
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">B2 Key ID</span>
                  <span className="text-zinc-50 font-mono">
                    {b2KeyId.slice(0, 8)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Bucket</span>
                  <span className="text-zinc-50">{b2BucketName}</span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="text-zinc-400">Endpoint</span>
                  <span className="text-zinc-50 text-xs font-mono text-right max-w-[250px] break-all">
                    {b2Endpoint}
                  </span>
                </div>

                <div className="border-t border-forge-border-strong my-1" />

                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Speed Targets
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Download</span>
                  <span className="text-emerald-400 font-medium font-mono">{downloadMbps} Mbps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Upload</span>
                  <span className="text-amber-400 font-medium font-mono">{uploadMbps} Mbps</span>
                </div>
              </div>

              <p className="text-xs text-zinc-500">
                You can adjust all settings later from the Settings page. Use the Schedule tab to
                automate test runs.
              </p>

              <div className="flex justify-between pt-2">
                <button
                  onClick={() => setStep(2)}
                  className="px-5 py-2 bg-forge-raised hover:bg-forge-border-strong text-zinc-50 text-sm font-medium rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Launch FloodTest'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
