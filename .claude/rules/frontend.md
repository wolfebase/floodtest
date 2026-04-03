---
paths:
  - "frontend/**/*.{ts,tsx}"
---
# Frontend Rules
- Run `cd frontend && npx vitest run` before committing
- React 18 + TypeScript + Tailwind dark theme
- Colors: Forge theme — zinc-950 (#09090b) bg, amber-500 (#f59e0b) primary, orange-600 (#ea580c) download, slate-400 (#94a3b8) upload, emerald-500 (#22c55e) success
- Fonts: Geist Sans (UI), Geist Mono (data/numbers) — use `font-mono` for all speed/byte values
- Custom Tailwind tokens: `forge-base`, `forge-surface`, `forge-raised`, `forge-border`, `forge-border-strong`, `forge-inset`
- Lazy-loaded pages via React Router
- Real-time data via `useWebSocket` hook, API client in `src/api/client.ts`
- Tests use `vi.stubGlobal` for fetch/WebSocket mocks — always clean up in afterEach
