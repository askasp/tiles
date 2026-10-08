import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { ask, desktopReady, launchDesktop } from './launch'
import { fixtureServer } from './fixture'

test('session list: ↵ opens in place, Ctrl+O back keeps the draft, Ctrl+I forward, Ctrl+↵ beside, Ctrl+Shift+↵ new workspace', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-trail-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page, { opencode: true })
    const k = await ask(page, 'chatos', false)
    await page.locator('.launcher-result').filter({ hasText: 'OpenCode project' }).first().click()
    await expect(k).toHaveCount(0)
    const list = page.locator('[data-kind="project"].tile-focused')
    await expect(list.locator('.session-row').first()).toBeVisible()
    const id = await list.getAttribute('data-tile-id')
    const tile = page.locator(`[data-tile-id="${id}"]`)

    // ↵: the session takes the list's place.
    await list.locator('.session-row').filter({ hasText: 'Consent reload' }).focus()
    await page.keyboard.press('Enter')
    await expect(tile).toHaveAttribute('data-kind', 'session')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(1)
    const composer = tile.locator('textarea')
    await composer.fill('half-written thought')

    // Ctrl+O from inside the composer: back to the list. Ctrl+I: forward, draft intact.
    await composer.press('Control+o')
    await expect(tile).toHaveAttribute('data-kind', 'project')
    await page.keyboard.press('Control+i')
    await expect(tile).toHaveAttribute('data-kind', 'session')
    await expect(tile.locator('textarea')).toHaveValue('half-written thought')
    // ⌘[ on a Mac (Ctrl+Alt+[ here) goes back too; reopening the session from the list keeps the draft.
    await tile.locator('textarea').press('Control+Alt+BracketLeft')
    await expect(tile).toHaveAttribute('data-kind', 'project')
    await tile.locator('.session-row').filter({ hasText: 'Consent reload' }).focus()
    await page.keyboard.press('Enter')
    await expect(tile.locator('textarea')).toHaveValue('half-written thought')
    await page.keyboard.press('Control+o')

    // Ctrl+↵: beside the list. Ctrl+Shift+↵: in a new workspace.
    await tile.locator('.session-row').filter({ hasText: 'Health sources' }).focus()
    await page.keyboard.press('Control+Enter')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(2)
    await expect(tile).toHaveAttribute('data-kind', 'project')
    const workspaces = await page.locator('.workspace-button').count()
    await tile.locator('.session-row').filter({ hasText: 'Consent tests' }).focus()
    await page.keyboard.press('Control+Shift+Enter')
    await expect(page.locator('.workspace-button')).toHaveCount(workspaces + 1)
    await expect(page.locator('.resource-tile:visible')).toHaveCount(1)
    await expect(page.locator('.resource-tile:visible')).toHaveAttribute('data-kind', 'session')
    expect(fixture.requests.filter(r => r.method === 'POST' && r.path.endsWith('/prompt'))).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
