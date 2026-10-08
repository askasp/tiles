import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { ask, desktopReady, fakeServices, launchDesktop } from './launch'
import { fixtureServer } from './fixture'
import type { TileDesktop } from '../../src/shared/tiles'

async function launcher(page: Page, query: string, mode = 'Enter') {
  await page.getByRole('button', { name: 'Launcher', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Launcher search' })
  await input.fill(query); await input.press(mode)
  await expect(input).toHaveCount(0)
}
async function state(page: Page) {
  return page.evaluate(() => JSON.parse(window.chatos.loadDesktop() || '{}')) as Promise<TileDesktop>
}

test('all-day desktop: five sessions, Slack DMs/mentions, mail/replies, PRs, shelf and find', async () => {
  test.setTimeout(120_000)
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-day-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  try {
    await desktopReady(page, { opencode: true })
    for (let i = 0; i < fixture.sessions.length; i++) {
      const session = fixture.sessions[i]
      await launcher(page, session.title!, i === 3 ? 'Control+Enter' : 'Enter')
      await page.locator(`[data-tile-id="${session.id}"] textarea`).fill(`Unsent draft ${i + 1}`)
    }
    await expect.poll(async () => (await state(page)).workspaces?.length).toBe(2)
    const sources = ['dm-carl', 'dm-kari', 'slack-mentions', 'front-inbox', 'front-replies', 'front-tagged', 'github-review-requested', 'github-pr-42', 'github-pr-43']
    // Accelerate workday interruptions: lunch, afternoon and evening repeats.
    for (let pass = 0; pass < 3; pass++) {
      for (const source of sources) {
        await launcher(page, `${fixture.url}/preview/${source}`)
        await expect(page.locator('.resource-tile:visible').first()).toBeVisible()
        expect(await page.locator('.resource-tile:visible').count()).toBeLessThanOrEqual(4)
        await expect(page.locator('.stage-tab')).toHaveCount(0)
        const identity = `${fixture.url}/preview/${source}`
        await expect.poll(() => app.evaluate(({ webContents }, url) => webContents.getAllWebContents().filter(c => c.getURL() === url).length, identity)).toBe(1)
      }
      await launcher(page, 'Consent reload')
      await expect(page.locator('[data-tile-id="ses_fixture_1"] textarea')).toHaveValue('Unsent draft 1')
      await launcher(page, 'PR cleanup')
      await expect(page.locator('[data-tile-id="ses_fixture_5"] textarea')).toHaveValue('Unsent draft 5')
      await launcher(page, `${fixture.url}/preview/dm-carl`, 'Shift+Enter')
      await page.getByRole('button', { name: 'Workspace overview', exact: true }).click()
      await expect(page.locator('.overview-shelf-row')).not.toHaveCount(0)
      await page.getByRole('button', { name: 'Close overview' }).click()
    }
    await expect.poll(async () => (await state(page)).tiles?.filter(t => t.kind === 'browser').length).toBe(sources.length)
    const s = await state(page)
    expect(new Set(s.tiles.map(t => t.key)).size).toBe(s.tiles.length)
    expect(s.tiles.filter(t => t.kind === 'session')).toHaveLength(5)
    expect(s.workspaces.length).toBeLessThanOrEqual(2)
    expect(s.workspaces.every(w => w.tileIDs.length <= 4)).toBe(true)
    for (let i = 0; i < fixture.sessions.length; i++) expect(s.tiles.find(t => t.sessionID === fixture.sessions[i].id)?.draft).toBe(`Unsent draft ${i + 1}`)
    expect(fixture.requests.filter(r => r.method !== 'GET' && !r.path.endsWith('/api/event'))).toEqual([])
    await page.screenshot({ path: 'test-results/v3-workday.png' })
    expect(errors).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})

test('settings: no service is listed until added; add Slack from K, manage it, remove it, no renderer secret persistence', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-settings-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url, CHATOS_CONNECTOR_URLS: fixture.connectorURLs }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page); await fakeServices(app)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Sources' })).not.toContainText('Slack')
    await page.getByRole('button', { name: 'Close settings', exact: true }).click()
    const k = await ask(page, 'add slack', false)
    await expect(page.locator('[data-connector-setup="slack"] .k-map')).toBeVisible()
    await k.press('Enter')
    await page.getByRole('textbox', { name: 'Connector token' }).fill('fake-private-token-for-settings-test')
    await page.getByRole('textbox', { name: 'Connector token' }).press('Enter')
    await expect(page.locator('[data-connector-setup="slack"]')).toContainText('Connected as me · Fixture')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Slack source' })).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const slack = page.locator('.source-row-details').filter({ hasText: 'Slack' })
    await slack.locator('summary').click()
    await expect(slack).toContainText('me · Fixture')
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('fake-private-token-for-settings-test')
    expect((await readFile(`${profile}/chatos.sqlite`)).includes(Buffer.from('fake-private-token-for-settings-test'))).toBe(false)
    await slack.getByRole('button', { name: 'Forget token', exact: true }).click()
    await expect(slack).toContainText('no API token')
    await slack.getByRole('button', { name: 'Remove Slack as a source' }).click()
    await expect(page.locator('.source-row-details').filter({ hasText: 'Slack' })).toHaveCount(0)
    expect(await page.evaluate(() => window.chatos.connectors())).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
