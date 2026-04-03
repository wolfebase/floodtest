import { test, expect } from '@playwright/test'

// In CI, the app starts fresh and may show the SetupWizard.
// Skip setup by saving default settings before UI tests.
test.beforeAll(async ({ request }) => {
  // Save minimal settings to skip the setup wizard
  await request.put('/api/settings', {
    data: {
      defaultDownloadMbps: 500,
      defaultUploadMbps: 500,
      uploadMode: 'http',
    },
  })
})

test.describe('Dashboard', () => {
  test('loads and shows dashboard heading', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
  })

  test('shows launch button on dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /launch engine/i })).toBeVisible()
  })
})

test.describe('Settings', () => {
  test('loads settings page', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /settings/i }).click()
    await expect(page.getByText('Download (Mbps)')).toBeVisible()
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
