import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../../hooks/useWebSocket'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readyState = 0

  constructor(_url: string) { MockWebSocket.instances.push(this) }
  close() { this.readyState = 3 }
  simulateOpen() { this.readyState = 1; this.onopen?.() }
  simulateMessage(data: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(data) }) }
  simulateClose() { this.readyState = 3; this.onclose?.() }
}

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket as unknown)
  vi.useFakeTimers()
})

describe('useWebSocket', () => {
  it('connects on mount', () => {
    renderHook(() => useWebSocket())
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('sets connected=true on open', () => {
    const { result } = renderHook(() => useWebSocket())
    expect(result.current.connected).toBe(false)
    act(() => MockWebSocket.instances[0].simulateOpen())
    expect(result.current.connected).toBe(true)
  })

  it('updates stats on message', () => {
    const { result } = renderHook(() => useWebSocket())
    act(() => MockWebSocket.instances[0].simulateOpen())
    act(() => { MockWebSocket.instances[0].simulateMessage({ downloadBps: 1000000, running: true }) })
    expect(result.current.stats.downloadBps).toBe(1000000)
    expect(result.current.stats.running).toBe(true)
  })

  it('reconnects after close with 2s delay', () => {
    renderHook(() => useWebSocket())
    act(() => MockWebSocket.instances[0].simulateOpen())
    act(() => MockWebSocket.instances[0].simulateClose())
    expect(MockWebSocket.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(2000))
    expect(MockWebSocket.instances).toHaveLength(2)
  })
})
