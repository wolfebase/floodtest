import { Suspense, lazy, useEffect, useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { Gauge, BarChart3, Clock, Settings as SettingsIcon, RefreshCw, Server, Flame, Menu, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from './api/client'
import { useWebSocket } from './hooks/useWebSocket'
import Dashboard from './components/Dashboard'

const Charts = lazy(() => import('./components/Charts'))
const SchedulePage = lazy(() => import('./components/Schedule'))
const SettingsPage = lazy(() => import('./components/Settings'))
const SetupWizard = lazy(() => import('./components/SetupWizard'))
const UpdatesPage = lazy(() => import('./components/Updates'))
const ServerHealth = lazy(() => import('./components/ServerHealth'))

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

function NavItem({ to, icon: Icon, label, onClick }: { to: string; icon: typeof Gauge; label: string; onClick?: () => void }) {
  const location = useLocation()
  const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={`nav-indicator group relative flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
        isActive
          ? 'active bg-cyan-500/8 text-cyan-400'
          : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04]'
      }`}
    >
      <motion.div
        className={`relative transition-transform duration-200 ${isActive ? '' : 'group-hover:scale-110'}`}
        whileHover={{ scale: 1.1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      >
        <Icon size={18} strokeWidth={isActive ? 2.5 : 1.8} />
        {isActive && <div className="absolute inset-0 blur-md bg-cyan-500/40" />}
      </motion.div>
      <span className="relative">{label}</span>
      {isActive && (
        <motion.div
          className="absolute right-3 w-1.5 h-1.5 rounded-full bg-cyan-400"
          animate={{ opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </NavLink>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {/* Brand */}
      <div className="px-5 py-5 border-b border-white/[0.04]">
        <div className="flex items-center gap-3">
          <motion.div
            className="relative"
            whileHover={{ scale: 1.05 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Flame size={18} className="text-white" strokeWidth={2.5} />
            </div>
            <motion.div
              className="absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 blur-lg"
              animate={{ opacity: [0.2, 0.4, 0.2] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
          <div>
            <div className="text-base font-bold text-gradient-fire tracking-tight">FloodTest</div>
            <div className="text-[10px] text-zinc-600 font-medium tracking-widest uppercase">Forge Engine</div>
          </div>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 flex flex-col px-3 py-4 gap-1">
        <div className="px-3 mb-2">
          <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.15em]">Monitor</span>
        </div>
        {mainNav.map((item) => (
          <NavItem key={item.to} {...item} onClick={onNavigate} />
        ))}
      </nav>

      {/* Bottom nav */}
      <nav className="px-3 py-3 border-t border-white/[0.04] flex flex-col gap-1">
        <div className="px-3 mb-1">
          <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.15em]">System</span>
        </div>
        {bottomNav.map((item) => (
          <NavItem key={item.to} {...item} onClick={onNavigate} />
        ))}
      </nav>

      {/* Version badge */}
      <div className="px-5 py-3 border-t border-white/[0.04]">
        <div className="flex items-center gap-2">
          <motion.div
            className="w-2 h-2 rounded-full bg-emerald-500"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <span className="text-[10px] text-zinc-600 font-mono">System Online</span>
        </div>
      </div>
    </>
  )
}

function Layout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const closeMobile = useCallback(() => setMobileMenuOpen(false), [])

  return (
    <div className="min-h-screen bg-forge-base">
      {/* Ambient background */}
      <div className="ambient-bg" />

      {/* Ambient background glow */}
      <div className="fixed top-0 left-0 lg:left-56 right-0 h-[300px] bg-gradient-to-b from-amber-500/[0.03] to-transparent pointer-events-none" />

      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 h-14 glass border-b border-white/[0.04] flex items-center justify-between px-4 z-50 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <Flame size={16} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-bold text-gradient-fire">FloodTest</span>
        </div>
        <motion.button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="w-9 h-9 rounded-lg glass-strong flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
          whileTap={{ scale: 0.95 }}
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </motion.button>
      </div>

      {/* Mobile menu overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={closeMobile}>
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.aside
              className="absolute top-14 left-0 bottom-0 w-64 bg-forge-surface border-r border-white/[0.04] flex flex-col overflow-y-auto"
              initial={{ x: -264, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -264, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <SidebarContent onNavigate={closeMobile} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside className="fixed top-0 left-0 h-screen w-56 bg-forge-surface/80 backdrop-blur-xl border-r border-white/[0.04] flex-col z-40 hidden lg:flex">
        <SidebarContent />
      </aside>

      {/* Main content */}
      <main className="pt-14 lg:pt-0 lg:ml-56 p-4 lg:p-6 relative z-10">
        {children}
      </main>
    </div>
  )
}

function ScreenLoader() {
  return (
    <div className="flex items-center justify-center h-screen bg-forge-base">
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="relative inline-block mb-4">
          <motion.div
            className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Flame size={24} className="text-white" strokeWidth={2.5} />
          </motion.div>
          <motion.div
            className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 blur-xl"
            animate={{ opacity: [0.2, 0.5, 0.2] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        </div>
        <div className="text-lg font-bold text-gradient-fire mb-1">FloodTest</div>
        <div className="text-zinc-500 text-sm">Initializing engine...</div>
      </motion.div>
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
      <Suspense fallback={<ScreenLoader />}>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard ws={ws} />} />
            <Route path="/charts" element={<Charts />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/updates" element={<UpdatesPage />} />
            <Route path="/servers" element={<ServerHealth />} />
          </Routes>
        </Layout>
      </Suspense>
    </BrowserRouter>
  )
}
