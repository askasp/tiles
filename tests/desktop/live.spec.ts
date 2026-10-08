import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { ask, desktopReady, launchDesktop, tileAction } from './launch'

test('live OpenCode: one session tile, shelf, and reopen without changing the session', async () => {
  const profile = await mkdtemp('/tmp/opencode/chatos-desktop-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), CHATOS_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env)
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await desktopReady(page)
    await ask(page, 'add opencode', false)
    await page.getByRole('button', { name: 'Connect to the running service' }).click()
    await expect(page.locator('[data-opencode-setup="connected"]')).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Enter')
    await desktopReady(page, { opencode: true })
    const snapshot = await page.evaluate(() => window.chatos.opencode.bootstrap())
    expect(snapshot.connection.connected).toBe(true)
    const idle = snapshot.sessions.data.find(session => !snapshot.active.includes(session.id))!
    expect(idle).toBeTruthy()
    const title = idle.title || 'New session'
    const openSession = async () => {
      await page.getByRole('button', { name: 'Launcher', exact: true }).click()
      await page.getByRole('textbox', { name: 'Launcher search' }).fill(title)
      await page.locator('.launcher-result').filter({ hasText: title }).first().click()
    }
    await openSession()
    await expect(page.locator('.resource-tile:visible')).toHaveCount(1)
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Unsent desktop smoke-test draft')
    await tileAction(page, page.locator('.resource-tile:visible'), 'Shelf (stays live)')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(0)
    await expect(page.locator('.shelf-chip')).toContainText(title)
    await openSession()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Unsent desktop smoke-test draft')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/live-v3-session.png' })
    expect(errors).toEqual([])
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }) }
})
