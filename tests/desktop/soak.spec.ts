import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, mkdir, appendFile } from 'node:fs/promises'
import { fixtureServer } from './fixture'
import { desktopReady, launchDesktop, tileAction } from './launch'
import type { TileDesktop } from '../../src/shared/tiles'

const hours = Number(process.env.CHATOS_SOAK_HOURS || '0')
test.use({ trace: 'off' })
test('extended sandboxed workflow soak with continuous UI actions and periodic restarts', async () => {
  test.skip(!Number.isFinite(hours) || hours <= 0, 'Opt in with CHATOS_SOAK_HOURS=3; never lengthen the normal test run.')
  test.setTimeout(hours * 3_600_000 + 120_000)
  const profile = await mkdtemp('/tmp/opencode/chatos-soak-')
  const fixture = await fixtureServer({ requestLimit: 5_000 })
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  await mkdir('/tmp/opencode/chatos-soak-results', { recursive: true })
  const log = `/tmp/opencode/chatos-soak-results/${Date.now()}.jsonl`
  const started = Date.now(), deadline = started + hours * 3_600_000
  let app: ElectronApplication | undefined, page: Page, cycle = 0
  const errors: string[] = []
  async function launch() {
    app = await launchDesktop(env); page = await app.firstWindow()
    page.setDefaultTimeout(10_000); page.on('pageerror', e => errors.push(e.message))
    await desktopReady(page, { opencode: true })
  }
  async function open(query: string, mode = 'Enter') {
    await page.getByRole('button', { name: 'Launcher', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'Launcher search' })
    await input.fill(query)
    if (!query.startsWith('http')) await expect(page.locator('.launcher-result').filter({ hasText: query }).first()).toBeVisible()
    await input.press(mode); await expect(input).toHaveCount(0)
  }
  try {
    await launch()
    for (let n = 0; n < fixture.sessions.length; n++) {
      const s = fixture.sessions[n]
      await open(s.title!, n === 3 ? 'Control+Enter' : 'Enter')
      await page!.locator(`[data-tile-id="${s.id}"] textarea`).fill(`Soak draft ${n + 1}`)
    }
    const sources = ['dm-carl', 'dm-kari', 'slack-mentions', 'front-inbox', 'front-replies', 'front-tagged', 'github-review-requested', ...Array.from({ length: 12 }, (_, n) => `github-pr-${n + 1}`)]
    while (Date.now() < deadline) {
      const s = fixture.sessions[cycle % 5]
      await open(s.title!)
      await expect(page!.locator(`[data-tile-id="${s.id}"] textarea`)).toHaveValue(`Soak draft ${cycle % 5 + 1}`)
      for (let n = 0; n < 3; n++) await open(`${fixture.url}/preview/${sources[(cycle * 3 + n) % sources.length]}`)
      if (cycle % 4 === 0) await open('Consent reload', 'Shift+Enter')
      if (cycle % 7 === 0) {
        fixture.askPermission('ses_fixture_1')
        await expect(page!.getByRole('button', { name: 'Go to waiting session' })).toContainText('1 waiting')
        await page!.getByRole('button', { name: 'Go to waiting session' }).click()
        await tileAction(page!, page!.locator('[data-tile-id="ses_fixture_1"]'), /^Allow once/)
      }
      const info = await page!.evaluate(() => JSON.parse(window.chatos.loadDesktop() || '{}')) as TileDesktop
      if (info.tiles) {
        expect(info.tiles.length).toBeLessThanOrEqual(24)
        expect(new Set(info.tiles.map(t => t.key)).size).toBe(info.tiles.length)
        expect(info.workspaces.every(w => w.tileIDs.length <= 4)).toBe(true)
        for (let n = 0; n < 5; n++) expect(info.tiles.find(t => t.sessionID === fixture.sessions[n].id)?.draft).toBe(`Soak draft ${n + 1}`)
      }
      expect(errors).toEqual([])
      if (cycle % 20 === 0) {
        const metrics = await app!.evaluate(({ webContents }) => ({ views: webContents.getAllWebContents().length, heap: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss }))
        expect(metrics.views).toBeLessThanOrEqual(20)
        await appendFile(log, JSON.stringify({ cycle, elapsedMinutes: (Date.now() - started) / 60_000, ...metrics }) + '\n')
      }
      cycle++
      if (cycle % 60 === 0) { await app!.close(); app = undefined; await launch() }
    }
    await appendFile(log, JSON.stringify({ result: 'passed', cycle, durationHours: (Date.now() - started) / 3_600_000 }) + '\n')
    console.log(`Soak passed: ${cycle} continuous cycles over ${hours} hours. Metrics: ${log}`)
  } catch (error) {
    await appendFile(log, JSON.stringify({ result: 'failed', cycle, error: String(error) }) + '\n'); throw error
  } finally { await app?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
