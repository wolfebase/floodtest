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

function Sidebar() {
  const mainNav = [
    { to: '/', icon: Gauge, label: 'Dashboard' },
    { to: '/charts', icon: BarChart3, label: 'Charts' },
    { to: '/schedule', icon: Clock, label: 'Schedule' },
    { to: '/servers', icon: Server, label: 'Servers' },
  ]
  const bottomNav = [
    { to: '/settings', icon: SettingsIcon, label: 'Settings' },
    { to: '/updates', icon: RefreshCw, label: 'Updates' },
  ]

  const NavItem = ({ to, icon: Icon, label }: { to: string; icon: typeof Gauge; label: string }) => (
    <NavLink
      key={to}
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-amber-500/10 text-amber-500'
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-forge-raised'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  )

  return (
    <aside className="fixed top-0 left-0 h-screen w-48 bg-forge-surface border-r border-forge-border flex flex-col z-40">
      <div className="px-4 py-4 border-b border-forge-border">
        <span className="text-sm font-bold text-zinc-50 tracking-tight">FloodTest</span>
      </div>
      <nav className="flex-1 flex flex-col px-2 py-2 gap-0.5">
        {mainNav.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
      <nav className="px-2 py-2 border-t border-forge-border flex flex-col gap-0.5">
        {bottomNav.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
    </aside>
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
        <Sidebar />
        <Suspense fallback={<ScreenLoader />}>
          <main className="ml-48 p-4">
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
