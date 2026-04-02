interface ModeToggleProps {
  mode: string
  onChange: (mode: string) => void
  compact?: boolean
}

export default function ModeToggle({ mode, onChange, compact }: ModeToggleProps) {
  const modes = [
    { key: 'reliable', label: 'Reliable' },
    { key: 'max', label: 'Max' },
  ]

  return (
    <div className={`inline-flex rounded-lg bg-gray-800 p-0.5 ${compact ? 'text-xs' : 'text-sm'}`}>
      {modes.map(m => (
        <button
          key={m.key}
          onClick={() => onChange(m.key)}
          className={`rounded-md font-medium transition-colors ${
            compact ? 'px-3 py-1' : 'px-5 py-2'
          } ${
            mode === m.key
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
