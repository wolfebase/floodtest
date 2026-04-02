import { Suspense, lazy, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { api } from './api/client'
import { useWebSocket } from './hooks/useWebSocket'
import Dashboard from './components/Dashboard'

const Charts = lazy(() => import('./components/Charts'))
const SchedulePage = lazy(() => import('./components/Schedule'))
const SettingsPage = lazy(() => import('./components/Settings'))
const SetupWizard = lazy(() => import('./components/SetupWizard'))
const UpdatesPage = lazy(() => import('./components/Updates'))

function NavBar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-600 text-white'
        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
    }`

  return (
    <nav className="flex items-center gap-2 px-6 py-3 bg-gray-900 border-b border-gray-800">
      <div className="flex items-center gap-2 mr-6">
        <svg className="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12c2-3 4-6 6-6s4 3 6 6 4 6 6 6"/>
          <path d="M2 6c2-3 4-6 6-6s4 3 6 6 4 6 6 6" opacity="0.5"/>
          <path d="M2 18c2-3 4-6 6-6s4 3 6 6 4 6 6 6" opacity="0.5"/>
        </svg>
        <h1 className="text-lg font-bold text-blue-400">FloodTest</h1>
      </div>
      <NavLink to="/" className={linkClass} end>Dashboard</NavLink>
      <NavLink to="/charts" className={linkClass}>Charts</NavLink>
      <NavLink to="/schedule" className={linkClass}>Schedule</NavLink>
      <NavLink to="/settings" className={linkClass}>Settings</NavLink>
      <NavLink to="/updates" className={linkClass}>Updates</NavLink>
    </nav>
  )
}

function ScreenLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-950">
      <div className="text-center">
        <div className="text-lg font-bold text-blue-400 mb-2">FloodTest</div>
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    </div>
  )
}

export default function App() {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [setupDone, setSetupDone] = useState(false)
  const ws = useWebSocket()

  useEffect(() => {
    api.isSetupRequired()
      .then((r) => setSetupRequired(r.required))
      .catch(() => setSetupRequired(false))
  }, [])

  if (setupRequired === null) {
    return <ScreenLoader />
  }

  if (setupRequired && !setupDone) {
    return (
      <Suspense fallback={<ScreenLoader />}>
        <SetupWizard onComplete={() => setSetupDone(true)} />
      </Suspense>
    )
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950">
        <NavBar />
        <Suspense fallback={<ScreenLoader />}>
          <main className="p-6 max-w-7xl mx-auto">
            <Routes>
              <Route path="/" element={<Dashboard ws={ws} />} />
              <Route path="/charts" element={<Charts />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/updates" element={<UpdatesPage />} />
            </Routes>
          </main>
        </Suspense>
      </div>
    </BrowserRouter>
  )
}
