import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { approvals, ask, desktopReady, fakeServices, launchDesktop, startSession } from './launch'
import { fixtureServer } from './fixture'

/** Slack and Front are built-in connectors pointed at the fixture's fake APIs; Slack pages are stubbed. No real accounts. */
const pages = (app: ElectronApplication, part: string) => app.evaluate(({ webContents }, p) => webContents.getAllWebContents().filter(c => c.getURL().includes(p)).length, part)
const livePages = (app: ElectronApplication) => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => /\/preview\/|\/client\/T123\//.test(c.getURL())).length)
const visibleTiles = (page: Page) => page.locator('.resource-tile:visible')

test('a developer day: Slack DMs, tagged Front mail with replies, 2 projects × 3 OpenCode sessions, heavy tile churn', async () => {
  test.setTimeout(300_000)
  const fixture = await fixtureServer()
  const profile = await mkdtemp('/tmp/opencode/chatos-dev-day-'), work = await mkdtemp('/tmp/opencode/chatos-dev-day-files-')
  await mkdir(`${work}/src`); await writeFile(`${work}/README.md`, 'hello'); await writeFile(`${work}/src/a.ts`, 'export {}'); await writeFile(`${work}/src/b.ts`, 'export {}')
  await mkdir(`${process.cwd()}/health-fixture`, { recursive: true })
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url, CHATOS_CONNECTOR_URLS: fixture.connectorURLs }
  delete env.ELECTRON_RUN_AS_NODE
  const timings: Record<string, number[]> = {}
  const time = async <T,>(name: string, run: () => Promise<T>) => { const start = Date.now(); const result = await run(); (timings[name] ||= []).push(Date.now() - start); return result }
  let app: ElectronApplication | undefined
  try {
    app = await launchDesktop(env)
    let page = await app.firstWindow()
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
    await desktopReady(page, { opencode: true })
    await fakeServices(app)

    // Morning: add Slack and Front from K. Nothing else is listed until added.
    for (const service of ['slack', 'front'] as const) {
      const k = await ask(page, `add ${service}`, false)
      await expect(page.locator(`[data-connector-setup="${service}"] .k-map`)).toBeVisible()
      await k.press('Enter')
      await page.getByRole('textbox', { name: 'Connector token' }).fill(`fake-${service}-token`)
      await page.getByRole('textbox', { name: 'Connector token' }).press('Enter')
      await expect(page.locator(`[data-connector-setup="${service}"]`)).toContainText('Connected as')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: `${service === 'slack' ? 'Slack' : 'Front'} source` })).toBeVisible()
    }

    // Read every DM sent to me. Each DM is one page in one tile.
    for (const person of ['Anna', 'Bob', 'Carl']) {
      const input = await ask(page, `dm ${person.toLowerCase()}`, false)
      await time('k-provider-result', () => expect(page.locator('.launcher-result').first()).toContainText(`DM ${person}`))
      await input.press('Enter')
      await expect(page.locator('.resource-tile.tile-focused .tile-title')).toHaveText(`DM ${person}`)
    }
    expect(await pages(app, '/client/T123/D101')).toBe(1)

    // Tagged Front mail: comment on one, reply to another.
    let input = await ask(page, 'mail tag:tag_me', false)
    await expect(page.locator('.launcher-result').first()).toContainText('Front · Inbox · tag:tag_me')
    await input.press('Enter')
    const inbox = page.locator('[data-kind="recipe"].tile-focused')
    await expect(inbox.locator('.recipe-list-row')).toHaveCount(3)
    const inboxID = await inbox.getAttribute('data-tile-id')
    for (const [subject, action, text] of [['Duplikate', 'Comment', 'Same root cause as last week — looking now.'], ['Login loop', 'Reply', 'Fixed in the 14:00 deploy. Can you confirm?']] as const) {
      await page.locator(`[data-tile-id="${inboxID}"] .recipe-list-row`).filter({ hasText: subject }).click()
      const conversation = page.locator('[data-kind="recipe"].tile-focused')
      await expect(conversation.locator('.recipe-message').first()).toBeVisible()
      const draft = conversation.getByRole('textbox', { name: 'Resource action draft' })
      await draft.fill(text)
      await conversation.getByRole('button', { name: new RegExp(`^${action}`) }).click()
      await expect(draft).toHaveValue('')
    }
    expect(fixture.frontWrites).toEqual([{ id: 'cnv_101', kind: 'comment', body: 'Same root cause as last week — looking now.' }, { id: 'cnv_102', kind: 'reply', body: 'Fixed in the 14:00 deploy. Can you confirm?' }])
    expect((await approvals(app)).filter(a => a.startsWith('Confirm'))).toHaveLength(2)

    // Work: three OpenCode sessions in each of two projects, in their own workspaces.
    for (const [slot, project] of [[3, 'chatos'], [4, 'health']] as const) {
      await page.keyboard.press(`Control+Alt+${slot}`)
      for (let n = 1; n <= 3; n++) {
        await time('start-session', () => startSession(page, project, `${project} task ${n}`))
        await expect(page.locator('[data-kind="session"].tile-focused .assistant-message').last()).toContainText('Fixture response')
      }
    }
    expect(fixture.requests.filter(r => r.method === 'POST' && r.path.endsWith('/api/session'))).toHaveLength(6)
    expect(fixture.requests.filter(r => r.method === 'POST' && r.path.endsWith('/prompt'))).toHaveLength(6)
    expect(fixture.requests.filter(r => r.method === 'POST' && r.path.endsWith('/api/session')).map(r => (r.body.location as { directory: string }).directory)).toEqual([...Array(3).fill(process.cwd()), ...Array(3).fill(`${process.cwd()}/health-fixture`)])

    // Files and a terminal next to the work, with i3 and vim keys.
    await page.keyboard.press('Control+Alt+5')
    input = await ask(page, `files ${work}`, false); await input.press('Enter')
    const folder = page.locator(`[data-resource-key="folder:${work}"]`)
    await expect(folder.locator('.file-entry')).toHaveCount(2)
    await folder.locator('.files-entries').focus()
    // Files: l goes into the folder in this tile, h comes back, Ctrl+Enter opens beside.
    const folderTile = await folder.getAttribute('data-tile-id')
    await page.keyboard.press('j'); await page.keyboard.press('k'); await page.keyboard.press('l')
    const inside = page.locator(`[data-tile-id="${folderTile}"]`)
    await expect(inside).toHaveAttribute('data-resource-key', `folder:${work}/src`)
    await page.keyboard.press('h')
    await expect(inside).toHaveAttribute('data-resource-key', `folder:${work}`)
    await page.keyboard.press('Alt+ArrowRight')
    await expect(inside).toHaveAttribute('data-resource-key', `folder:${work}/src`)
    await page.keyboard.press('Minus')
    await expect(inside).toHaveAttribute('data-resource-key', `folder:${work}`)
    await expect(inside.locator('.file-entry')).toHaveCount(2)
    await inside.locator('.files-entries').focus()
    await page.keyboard.press('Control+Enter')
    await expect(page.locator(`[data-resource-key="folder:${work}/src"]`)).toBeVisible()
    await expect(inside).toHaveAttribute('data-resource-key', `folder:${work}`)
    await page.keyboard.press('Control+Alt+t')
    await expect(page.locator('[data-kind="terminal"]:visible .xterm')).toBeVisible()
    const focusedID = () => page.locator('.resource-tile.tile-focused').getAttribute('data-tile-id')
    await page.locator(`[data-tile-id="${folderTile}"] .files-toolbar strong`).click()
    const before = await focusedID()
    // Vim window keys: Ctrl+W, then h/j/k/l.
    await page.keyboard.press('Control+w'); await expect(page.locator('.chord-hint')).toBeVisible(); await page.keyboard.press('l')
    await expect.poll(focusedID).not.toBe(before)
    await page.keyboard.press('Control+w'); await page.keyboard.press('h')
    await expect.poll(focusedID).toBe(before)

    // The rest of the day: many interruptions. Measure what grows.
    const sizes: { pass: number; tiles: number; mounted: number; browsers: number; pages: number; workspaces: number; terminals: number }[] = []
    for (let pass = 0; pass < Number(process.env.DAY_PASSES || 4); pass++) {
      for (const person of ['Anna', 'Bob', 'Carl']) {
        input = await ask(page, `dm ${person.toLowerCase()}`, false)
        await expect(page.locator('.launcher-result').first()).toContainText(`DM ${person}`)
        await input.press(pass % 2 ? 'Control+Enter' : 'Enter')
      }
      for (let n = 0; n < 6; n++) {
        input = await ask(page, `${fixture.url}/preview/doc-${pass}-${n}`, false)
        await time('k-url', () => expect(page.locator('.launcher-result').first()).toContainText('Open in Browser'))
        await input.press('Enter')
      }
      // A duplicate URL goes to its tile: never a second page or a tab.
      input = await ask(page, `${fixture.url}/preview/doc-${pass}-0`, false); await input.press('Enter')
      expect(await pages(app, `/preview/doc-${pass}-0`)).toBe(1)
      for (const [project, n] of [['chatos', 1], ['health', 3]] as const) {
        input = await ask(page, `${project} task ${n}`, false)
        await time('k-session', () => expect(page.locator('.launcher-result').first()).toContainText(`${project} task ${n}`))
        await input.press('Enter')
        await page.locator('[data-kind="session"].tile-focused textarea').fill(`draft ${pass}`)
      }
      await page.keyboard.press('Control+Alt+Shift+2')
      await page.keyboard.press('Control+Alt+Minus')
      await page.keyboard.press('Control+Alt+Equal')
      await page.keyboard.press('Control+Alt+t')
      await expect(page.locator('[data-kind="terminal"].tile-focused .xterm')).toBeVisible()
      await page.locator('[data-kind="terminal"].tile-focused .terminal-host').click()
      await page.keyboard.press('Control+Alt+w')
      await expect(page.locator('.stage-tab, .browser-tabs')).toHaveCount(0)
      for (const w of await page.locator('.workspace-button').all()) expect(Number((await w.locator('small').textContent())?.replace(/\D/g, '') || 0)).toBeLessThanOrEqual(4)
      await page.waitForTimeout(300)
      sizes.push({ pass, tiles: await page.evaluate(() => JSON.parse(window.chatos.loadDesktop() || '{}').tiles?.length || 0), mounted: await page.locator('.resource-tile').count(), browsers: await page.locator('.resource-tile[data-kind="browser"]').count(), pages: await livePages(app), workspaces: await page.locator('.workspace-button').count(), terminals: await page.locator('.resource-tile[data-kind="terminal"]').count() })
    }
    console.log('DAY sizes', JSON.stringify(sizes))
    console.log('DAY kinds', JSON.stringify(await page.locator('.resource-tile').evaluateAll(els => els.reduce<Record<string, number>>((m, e) => { const k = `${(e as HTMLElement).dataset.kind}`; m[k] = (m[k] || 0) + 1; return m }, {}))))
    await expect(page.locator('.connection-banner')).toHaveCount(0)
    // What is saved matches what is on screen (saving keeps up with a busy desktop).
    expect(sizes.at(-1)!.tiles).toBeGreaterThanOrEqual(sizes.at(-1)!.mounted)
    const keys = await page.evaluate(() => (JSON.parse(window.chatos.loadDesktop() || '{}').tiles as { key: string }[]).map(t => t.key))
    expect(new Set(keys).size).toBe(keys.length)
    // Nothing leaks: a live page exists only for a live browser tile, and live tiles are bounded by
    // what's on the workspaces plus a small shelf, however much was opened today.
    for (const size of sizes) {
      expect(size.pages).toBe(size.browsers)
      expect(size.workspaces).toBeLessThanOrEqual(9)
      expect(size.mounted).toBeLessThanOrEqual(size.workspaces * 4 + 8 + size.terminals)
    }

    // Restart mid-day: everything comes back where it was, drafts included.
    const beforeRestart = await page.evaluate(() => window.chatos.loadDesktop())
    await app.close()
    app = await launchDesktop(env); await fakeServices(app); page = await app.firstWindow()
    await desktopReady(page, { opencode: true })
    const afterRestart = await page.evaluate(() => window.chatos.loadDesktop())
    expect(JSON.parse(afterRestart!).tiles.length).toBe(JSON.parse(beforeRestart!).tiles.length)
    input = await ask(page, 'chatos task 1', false); await input.press('Enter')
    await expect(page.locator('[data-kind="session"].tile-focused textarea')).toHaveValue(`draft ${Number(process.env.DAY_PASSES || 4) - 1}`)
    expect(errors).toEqual([])
    console.log('DAY timings ms', JSON.stringify(Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, { n: v.length, max: Math.max(...v), avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }]))))
    await page.screenshot({ path: 'test-results/developer-day.png' })
  } finally { await app?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }); await rm(work, { recursive: true, force: true }) }
})
