import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { desktopReady, launchDesktop, tileAction } from './launch'
import { fixtureServer } from './fixture'

async function open(page: Page, query: string, mode = 'Enter') {
  await page.getByRole('button', { name: 'Launcher', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Launcher search' }); await input.fill(query)
  await expect(page.locator('.launcher-result').filter({ hasText: query }).first()).toBeVisible()
  await input.press(mode); await expect(input).toHaveCount(0)
}

test('reading position and partial agent answers survive workspace/empty desktop/shelf switching', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-continuity-')
  fixture.seedHistory('ses_fixture_1', 60)
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page, { opencode: true })
    await open(page, 'Consent reload')
    const session = page.locator('[data-tile-id="ses_fixture_1"]'), scroll = session.locator('.chat-scroll')
    await expect(session.locator('.assistant-message')).toHaveCount(60)
    fixture.askQuestion('ses_fixture_1')
    await session.locator('.question-card select').selectOption('device')
    await scroll.evaluate(e => { e.scrollTop = 220; e.dispatchEvent(new Event('scroll')) })
    await open(page, 'Health sources', 'Control+Enter')
    await expect(session).not.toBeVisible()
    await page.keyboard.press('Control+Alt+0')
    await expect(page.getByRole('region', { name: 'Empty desktop' })).toBeVisible()
    await open(page, 'Consent reload')
    await expect(session.locator('.question-card select')).toHaveValue('device')
    await expect.poll(() => scroll.evaluate(e => e.scrollTop)).toBe(220)
    await tileAction(page, page.locator('.resource-tile:visible'), 'Shelf (stays live)')
    await open(page, 'Consent reload')
    await expect(session.locator('.question-card select')).toHaveValue('device')
    await expect.poll(() => scroll.evaluate(e => e.scrollTop)).toBe(220)
    expect(fixture.requests.filter(r => r.method !== 'GET')).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})

test('browser popup reuses URL owner and native browser shortcuts open the launcher', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-browser-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page, { opencode: true })
    await open(page, `${fixture.url}/preview/dm-carl`)
    await open(page, `${fixture.url}/preview/front-inbox`, 'Control+Enter')
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().includes('/preview/')).length)).toBe(2)
    await app.evaluate(({ webContents }) => { const contents = webContents.getAllWebContents().find(c => c.getURL().endsWith('/front-inbox'))!; void contents.executeJavaScript("window.open('/preview/dm-carl', '_blank')") })
    await expect(page.locator('.resource-tile:visible .tile-title')).toHaveText('dm carl')
    expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().includes('/preview/')).length)).toBe(2)
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible() && 'webContents' in v && (v as Electron.WebContentsView).webContents.getURL().includes('/preview/')).length)).toBe(1)
    await app.evaluate(({ webContents }) => { const contents = webContents.getAllWebContents().find(c => c.getURL().endsWith('/dm-carl'))!; contents.focus(); contents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['control'] }) })
    // Ctrl+K belongs to the page (Slack, GitHub); ⌘K / Ctrl+Alt+K opens K from inside it.
    await page.waitForTimeout(300)
    await expect(page.getByRole('textbox', { name: 'Launcher search' })).toHaveCount(0)
    await app.evaluate(({ webContents }) => { const contents = webContents.getAllWebContents().find(c => c.getURL().endsWith('/dm-carl'))!; contents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control', 'alt'] }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['control', 'alt'] }) })
    await expect(page.getByRole('textbox', { name: 'Launcher search' })).toBeVisible()
    // Opened from inside a web page, K still gets the keyboard.
    await expect(page.getByRole('textbox', { name: 'Launcher search' })).toBeFocused()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isFocused())).toBe(true)
    await page.getByRole('textbox', { name: 'Launcher search' }).press('Shift+Tab')
    await expect(page.locator('[role="dialog"] .launcher-result').last()).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('textbox', { name: 'Launcher search' })).toBeFocused()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible() && 'webContents' in v && (v as Electron.WebContentsView).webContents.getURL().includes('/preview/')).length)).toBe(0)
    await page.getByRole('button', { name: 'Close launcher' }).click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => v.getVisible() && 'webContents' in v && (v as Electron.WebContentsView).webContents.getURL().includes('/preview/')).length)).toBe(1)
    await tileAction(page, page.locator('.resource-tile:visible'), 'Rename')
    await page.getByRole('textbox', { name: 'Tile name' }).fill('DM Carl · important')
    await page.getByRole('button', { name: 'Save name', exact: true }).click()
    await app.evaluate(async ({ webContents }) => { await webContents.getAllWebContents().find(c => c.getURL().endsWith('/dm-carl'))!.executeJavaScript("document.title = 'Generic Slack page'") })
    await expect(page.locator('.resource-tile:visible .tile-title')).toHaveText('DM Carl · important')
    await tileAction(page, page.locator('.resource-tile:visible'), 'Shelf (stays live)')
    await open(page, 'DM Carl · important')
    await expect(page.locator('.resource-tile:visible .tile-title')).toHaveText('DM Carl · important')
    const browserID = await page.locator('.resource-tile:visible').getAttribute('data-tile-id')
    await app.evaluate(async ({ webContents }) => { await webContents.getAllWebContents().find(c => c.getURL().endsWith('/dm-carl'))!.executeJavaScript("const r=document.createRange(); r.selectNodeContents(document.querySelector('h1')); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r)") })
    const selected = await page.evaluate(id => window.chatos.browserContext(id!, true), browserID)
    expect(selected.text).toBe('dm carl')
    await app.evaluate(async ({ webContents }) => { await webContents.getAllWebContents().find(c => c.getURL().endsWith('/dm-carl'))!.executeJavaScript("const p=document.createElement('input'); p.type='password'; p.value='do-not-attach'; document.body.appendChild(p); p.focus(); p.select()") })
    expect((await page.evaluate(id => window.chatos.browserContext(id!, true), browserID)).text).toBe('')
    await open(page, `${fixture.url}/preview/undo-browser`)
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().endsWith('/undo-browser')).length)).toBe(1)
    await page.getByRole('button', { name: 'Undo arrangement', exact: true }).click()
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().endsWith('/undo-browser')).length)).toBe(0)
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})

test('attention navigation cycles through every waiting session, not just the first two', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-attention-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page, { opencode: true })
    await open(page, 'Consent reload')
    await open(page, 'Health sources')
    await open(page, 'Consent tests')
    for (const id of ['ses_fixture_1', 'ses_fixture_2', 'ses_fixture_3']) fixture.askPermission(id)
    await expect(page.getByRole('button', { name: 'Go to waiting session' })).toContainText('3 waiting')
    const visited = new Set<string>()
    for (let n = 0; n < 3; n++) {
      await page.getByRole('button', { name: 'Go to waiting session' }).click()
      visited.add((await page.locator('.resource-tile.tile-focused:visible').getAttribute('data-tile-id'))!)
    }
    expect([...visited].sort()).toEqual(['ses_fixture_1', 'ses_fixture_2', 'ses_fixture_3'])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})

test('switching workspaces from a focused web page keeps the workspace keys working', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-page-focus-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  // Keys typed like a person: delivered to whichever web contents has the keyboard.
  const press = (keyCode: string, modifiers: string[]) => app.evaluate(({ webContents }, [code, mods]) => {
    const target = webContents.getFocusedWebContents() || webContents.getAllWebContents()[0]
    target.sendInputEvent({ type: 'keyDown', keyCode: code as string, modifiers: mods as Electron.InputEvent['modifiers'] }); target.sendInputEvent({ type: 'keyUp', keyCode: code as string, modifiers: mods as Electron.InputEvent['modifiers'] })
  }, [keyCode, modifiers] as const)
  try {
    await desktopReady(page, { opencode: true })
    await open(page, `${fixture.url}/preview/focus-test`)
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().endsWith('/focus-test')).length)).toBe(1)
    await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(c => c.getURL().endsWith('/focus-test'))!.focus())
    await press('3', ['control', 'alt'])
    await expect(page.locator('.workspace-button.selected')).toContainText('3')
    // The hidden page gave the keyboard back, so the next workspace key works.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isFocused())).toBe(true)
    await press('1', ['control', 'alt'])
    await expect(page.locator('.workspace-button.selected')).toContainText('1')
    await expect(page.locator('[data-kind="browser"]:visible')).toHaveCount(1)
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
