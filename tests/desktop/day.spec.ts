import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { launchDesktop } from './launch'
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
    await expect(page.locator('.project-row').first()).toBeVisible()
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

test('settings: service URLs, token fallback, remove token, and no renderer secret persistence', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-settings-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await page.getByRole('button', { name: 'Connection settings', exact: true }).click()
    await expect(page.locator('.service-card')).toHaveCount(3)
    const slack = page.locator('.service-card').filter({ hasText: 'Slack' })
    await slack.getByRole('textbox', { name: 'Slack URL' }).fill('https://example-workspace.slack.com/')
    await slack.getByRole('button', { name: 'Save URL', exact: true }).click()
    await expect(slack.getByRole('status')).toHaveText('URL saved.')
    await slack.getByRole('textbox', { name: 'Slack API token' }).fill('fake-private-token-for-settings-test')
    await slack.getByRole('button', { name: 'Save token', exact: true }).click()
    await expect(slack.getByRole('textbox', { name: 'Slack API token' })).toHaveValue('')
    await expect(slack).toContainText('Token ·')
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage })) ).not.toContain('fake-private-token-for-settings-test')
    expect((await readFile(`${profile}/chatos.sqlite`)).includes(Buffer.from('fake-private-token-for-settings-test'))).toBe(false)
    expect(await page.evaluate(() => window.chatos.services())).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'slack', hasToken: true, url: 'https://example-workspace.slack.com/' })]))
    await slack.getByRole('button', { name: 'Remove token', exact: true }).click()
    await expect(slack).toContainText('No API token')
    expect(await page.evaluate(() => window.chatos.services())).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'slack', hasToken: false })]))
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
