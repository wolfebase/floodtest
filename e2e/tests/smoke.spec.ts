import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('loads and shows dashboard content', async ({ page }) => {
    await page.goto('/')
    // Wait for the app to finish loading (ScreenLoader disappears when isSetupRequired resolves)
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15000 })
    // Verify mode selector is present (Reliable/Max buttons)
    await expect(page.getByRole('button', { name: /reliable/i })).toBeVisible()
  })

  test('shows mode selector buttons', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('button', { name: /reliable/i })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: /max/i })).toBeVisible()
  })
})

test.describe('Settings', () => {
  test('loads settings page', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Download (Mbps)')).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Schedule', () => {
  test('loads schedule page', async ({ page }) => {
    await page.goto('/schedule')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Charts', () => {
  test('loads charts page without error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/charts')
    await page.waitForLoadState('networkidle')
    expect(errors).toHaveLength(0)
  })
})

test.describe('API Smoke', () => {
  test('GET /api/status returns JSON', async ({ request }) => {
    const res = await request.get('/api/status')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body).toHaveProperty('running')
  })

  test('GET /api/settings returns JSON', async ({ request }) => {
    const res = await request.get('/api/settings')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body).toHaveProperty('uploadMode')
  })

  test('GET /api/schedules returns array', async ({ request }) => {
    const res = await request.get('/api/schedules')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})
