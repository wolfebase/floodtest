import { Suspense, lazy, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Gauge, BarChart3, Clock, Settings as SettingsIcon, RefreshCw, Server } from 'lucide-react'
import { api } from './api/client'
import { useWebSocket } from './hooks/useWebSocket'
import Dashboard from './components/Dashboard'

const Charts = lazy(() => import('./components/Charts'))
const SchedulePage = lazy(() => import('./components/Schedule'))
const SettingsPage = lazy(() => import('./components/Settings'))
const SetupWizard = lazy(() => import('./components/SetupWizard'))
const UpdatesPage = lazy(() => import('./components/Updates'))
const ServerHealth = lazy(() => import('./components/ServerHealth'))

function NavBar() {
  const navItems = [
    { to: '/', icon: Gauge, label: 'Dashboard' },
    { to: '/charts', icon: BarChart3, label: 'Charts' },
    { to: '/schedule', icon: Clock, label: 'Schedule' },
    { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    { to: '/updates', icon: RefreshCw, label: 'Updates' },
    { to: '/servers', icon: Server, label: 'Servers' },
  ]

  return (
    <nav className="flex items-center gap-1 px-3 h-10 bg-forge-surface border-b border-forge-border">
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `relative p-2 rounded-md transition-colors group ${
              isActive
                ? 'text-amber-500'
                : 'text-zinc-500 hover:text-zinc-300'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={18} strokeWidth={2} />
              {isActive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-amber-500 rounded-full" />
              )}
              <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-0.5 text-xs font-medium text-zinc-300 bg-zinc-800 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function ScreenLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-forge-base">
      <div className="text-center">
        <div className="text-lg font-bold text-amber-400 mb-2">FloodTest</div>
        <div className="text-zinc-400 text-sm">Loading...</div>
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
      <div className="min-h-screen bg-forge-base">
        <NavBar />
        <Suspense fallback={<ScreenLoader />}>
          <main className="p-3">
            <Routes>
              <Route path="/" element={<Dashboard ws={ws} />} />
              <Route path="/charts" element={<Charts />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/updates" element={<UpdatesPage />} />
              <Route path="/servers" element={<ServerHealth />} />
            </Routes>
          </main>
        </Suspense>
      </div>
    </BrowserRouter>
  )
}
