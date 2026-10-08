import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { launchDesktop } from './launch'
import { fixtureServer } from './fixture'

test('slow session creation preserves new Home edits and prevents duplicate initial sends', async () => {
  const fixture = await fixtureServer({ createDelay: 700, promptDelay: 700 })
  const profile = await mkdtemp('/tmp/opencode/chatos-concurrent-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await expect(page.locator('.project-row').first()).toBeVisible()
    const home = page.getByRole('textbox', { name: 'New session prompt' })
    await home.fill('Initial task')
    await page.getByRole('button', { name: 'Start session', exact: true }).click()
    await home.fill('Next task draft written while creating')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(1)
    const id = fixture.sessions[0].id
    await expect(page.locator(`[data-tile-id="${id}"]`).getByRole('button', { name: 'Send message', exact: true })).toBeDisabled()
    await expect(page.locator('.assistant-message')).toContainText('Fixture response')
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await expect(home).toHaveValue('Next task draft written while creating')
    expect(fixture.requests.filter(r => r.path.endsWith('/prompt'))).toHaveLength(1)
    expect(fixture.requests.find(r => r.path.endsWith('/prompt'))?.body.text).toBe('Initial task')
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})

test('an unmatched source query never creates an unrelated OpenCode session', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-no-accidental-session-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await expect(page.locator('.project-row').first()).toBeVisible()
    await page.getByRole('button', { name: 'Launcher', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'Launcher search' })
    await input.fill('dm unknown-person-never-opened'); await input.press('Enter')
    await expect(input).toBeVisible()
    await expect(page.locator('.modal-footer')).toContainText('API token in Settings')
    expect(fixture.requests.filter(r => r.method === 'POST')).toEqual([])
    await expect(page.locator('.launcher-result')).toHaveCount(0)
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
