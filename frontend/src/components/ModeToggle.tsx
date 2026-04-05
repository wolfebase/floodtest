import { Shield, Zap } from 'lucide-react'
import { motion } from 'framer-motion'

interface ModeToggleProps {
  mode: string
  onChange: (mode: string) => void
  compact?: boolean
}

export default function ModeToggle({ mode, onChange, compact }: ModeToggleProps) {
  const modes = [
    { key: 'reliable', label: 'Reliable', icon: Shield },
    { key: 'max', label: 'Max', icon: Zap },
  ]

  return (
    <div className={`inline-flex rounded-xl glass-inset p-1 ${compact ? 'text-xs' : 'text-sm'}`}>
      {modes.map(m => {
        const Icon = m.icon
        const isActive = mode === m.key
        return (
          <motion.button
            key={m.key}
            onClick={() => onChange(m.key)}
            className={`flex items-center gap-1.5 rounded-lg font-medium transition-all duration-200 ${
              compact ? 'px-3 py-1.5' : 'px-4 py-2'
            } ${
              isActive
                ? m.key === 'max'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/20 shadow-sm shadow-red-500/10'
                  : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm shadow-cyan-500/10'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <Icon size={compact ? 12 : 14} strokeWidth={isActive ? 2.5 : 2} />
            <span>{m.label}</span>
          </motion.button>
        )
      })}
    </div>
  )
}
