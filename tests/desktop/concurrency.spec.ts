import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { ask, desktopReady, launchDesktop } from './launch'
import { fixtureServer } from './fixture'

test('starting a session from K with a first message runs once, even with repeated Enter', async () => {
  const fixture = await fixtureServer({ createDelay: 700, promptDelay: 700 })
  const profile = await mkdtemp('/tmp/opencode/chatos-concurrent-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page, { opencode: true })
    const input = await ask(page, 'start session in chatos: Initial task', false)
    await expect(page.locator('.launcher-result').first()).toContainText('first message: Initial task')
    await expect(page.locator('.k-chips')).toContainText('Initial task')
    await input.press('Enter'); await page.keyboard.press('Enter')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(1)
    await expect(page.locator('.assistant-message')).toContainText('Fixture response')
    expect(fixture.requests.filter(r => r.method === 'POST' && r.path.endsWith('/api/session'))).toHaveLength(1)
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
    await desktopReady(page, { opencode: true })
    await ask(page, 'dm unknown-person-never-opened', false)
    // Slack isn't a source here: only the explicit web search is offered, nothing is created.
    await expect(page.locator('.launcher-result')).toHaveCount(1)
    await expect(page.locator('.launcher-result')).toContainText('Search the web')
    await expect(page.locator('.launcher-result').filter({ hasText: 'Start' })).toHaveCount(0)
    expect(fixture.requests.filter(r => r.method === 'POST')).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
