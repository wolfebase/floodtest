import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('loads and shows mode selector', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'FloodTest', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /start|stop/i })).toBeVisible()
  })

  test('shows download and upload speed cards', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Download', { exact: true })).toBeVisible()
    await expect(page.getByText('Upload', { exact: true })).toBeVisible()
  })
})

test.describe('Settings', () => {
  test('loads settings page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /settings/i }).click()
    await expect(page.getByText('Download (Mbps)', { exact: true })).toBeVisible()
  })
})

test.describe('Schedule', () => {
  test('loads schedule page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /schedule/i }).click()
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible()
  })
})

test.describe('Charts', () => {
  test('loads charts page without error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/')
    await page.getByRole('link', { name: /charts/i }).click()
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
