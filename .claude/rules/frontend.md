---
paths:
  - "frontend/**/*.{ts,tsx}"
---
# Frontend Rules
- Run `cd frontend && npx vitest run` before committing
- React 18 + TypeScript + Tailwind dark theme
- Colors: slate-900 (#0f172a) bg, cyan-400 (#22d3ee) download, violet-400 (#a78bfa) upload, emerald-400 (#34d399) success
- Lazy-loaded pages via React Router
- Real-time data via `useWebSocket` hook, API client in `src/api/client.ts`
- Tests use `vi.stubGlobal` for fetch/WebSocket mocks — always clean up in afterEach
