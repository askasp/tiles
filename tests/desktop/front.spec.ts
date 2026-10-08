import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { launchDesktop } from './launch'
import { fixtureServer } from './fixture'

async function mockFront(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const calls: { type: string; query?: string; id?: string; cursor?: string }[] = []
    ;(globalThis as typeof globalThis & { frontFixtureCalls: typeof calls }).frontFixtureCalls = calls
    ipcMain.removeHandler('chatos:frontConversations')
    ipcMain.removeHandler('chatos:frontConversation')
    ipcMain.handle('chatos:frontConversations', (_event, input: { query: string; cursor?: string }) => {
      calls.push({ type: 'list', ...input })
      return { items: [{ id: input.cursor ? 'cnv_456' : 'cnv_123', subject: input.cursor ? 'Older mail' : 'Lab reply', sender: 'carl@example.test', preview: 'Results are ready.', status: 'assigned', tags: ['mine'] }], next: input.cursor ? undefined : 'next-list' }
    })
    ipcMain.handle('chatos:frontConversation', (_event, input: { id: string; cursor?: string }) => {
      calls.push({ type: 'conversation', ...input })
      return { conversation: { id: input.id, subject: 'Lab reply', sender: 'carl@example.test', status: 'assigned', tags: ['mine'] }, messages: [{ id: input.cursor ? 'msg_old' : 'msg_new', subject: 'Lab reply', text: input.cursor ? 'Original message from me.' : 'Hello! Your lab results are ready. <script>this is inert text</script>', inbound: !input.cursor, draft: false, createdAt: input.cursor ? 1699999900000 : 1700000000000, recipients: [{ role: 'from', handle: input.cursor ? 'me@example.test' : 'carl@example.test', name: 'Carl' }], attachments: [{ name: 'results.txt', size: 2048 }] }], next: input.cursor ? undefined : 'next-message' }
    })
  })
}

test('Front token opens API-native filters, paged conversations and direct message tiles without web login', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-front-native-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  try {
    app = await launchDesktop(env); await mockFront(app)
    let page = await app.firstWindow()
    await expect(page.locator('.project-row').first()).toBeVisible()
    await page.getByRole('button', { name: 'Connection settings', exact: true }).click()
    const settings = page.locator('.service-card').filter({ has: page.getByRole('textbox', { name: 'Front API token' }) })
    await settings.getByRole('textbox', { name: 'Front API token' }).fill('fake-front-private-token')
    await settings.getByRole('button', { name: 'Save token', exact: true }).click()
    await expect(settings.getByRole('textbox', { name: 'Front API token' })).toHaveValue('')
    await settings.getByRole('textbox', { name: 'Front filter email' }).fill('me@example.test')
    await settings.getByRole('textbox', { name: 'Front teammate ID' }).fill('tea_123')
    await settings.getByRole('textbox', { name: 'Front tag ID' }).fill('tag_abc')
    await settings.getByRole('button', { name: 'Save mail filters', exact: true }).click()
    await expect(settings.getByRole('status')).toHaveText('Front mail filters saved.')
    await settings.getByRole('button', { name: 'Open Front API inbox', exact: true }).click()
    await expect(page.locator('[data-kind="front-list"]:visible')).toHaveCount(1)
    await expect(page.locator('.front-conversation-row')).toContainText('Lab reply')
    await page.getByRole('button', { name: 'More conversations', exact: true }).click()
    await expect(page.locator('.front-conversation-row')).toHaveCount(2)
    await page.getByRole('button', { name: 'Addressed to me', exact: true }).click()
    const filtered = page.locator('[data-kind="front-list"]:visible').filter({ hasText: 'to:me@example.test' })
    await expect(filtered).toHaveCount(1)
    await expect(filtered.locator('.front-conversation-row')).toHaveCount(1)
    await filtered.locator('.front-results').focus()
    await page.keyboard.press('Enter')
    const reader = page.locator('[data-kind="front-conversation"]:visible')
    await expect(reader.locator('.front-message-text')).toContainText('Your lab results are ready')
    await expect(reader.locator('script, img, iframe')).toHaveCount(0)
    await reader.getByRole('button', { name: 'Older messages', exact: true }).click()
    await expect(reader.locator('.front-message')).toHaveCount(2)
    await expect(reader.locator('.front-message').first()).toContainText('Your lab results are ready')
    await expect(reader).toContainText('Original message from me.')
    await expect(reader).toContainText('results.txt')
    const readerID = await reader.getAttribute('data-tile-id')
    await page.getByRole('button', { name: 'Launcher', exact: true }).click()
    await page.getByRole('textbox', { name: 'Launcher search' }).fill('https://app.frontapp.com/open/cnv_123')
    await page.getByRole('textbox', { name: 'Launcher search' }).press('Enter')
    await expect(page.locator('[data-kind="front-conversation"]')).toHaveCount(1)
    expect(await reader.getAttribute('data-tile-id')).toBe(readerID)
    expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().includes('frontapp.com')).length)).toBe(0)
    // Block the optional web fallback completely in this fixture. Verify the
    // presentation switch without loading or logging into any real account.
    await app.evaluate(({ session }) => session.fromPartition('persist:chatos-web').webRequest.onBeforeRequest({ urls: ['https://app.frontapp.com/*'] }, (_details, callback) => callback({ cancel: true })))
    await reader.getByRole('button', { name: 'Open in Front / reply', exact: true }).click()
    const fallback = page.locator(`[data-tile-id="${readerID}"][data-kind="browser"]`)
    await expect(fallback).toBeVisible()
    await expect(fallback).toHaveAttribute('data-resource-key', 'front:cnv_123')
    await fallback.getByRole('button', { name: 'Use Front API', exact: true }).click()
    await expect(reader).toBeVisible()
    await expect(reader.locator('.tile-title')).toHaveText('Lab reply')
    await expect(page.locator('[data-resource-key="front:cnv_123"]')).toHaveCount(1)
    const calls = await app.evaluate(() => (globalThis as typeof globalThis & { frontFixtureCalls: { type: string; query?: string; cursor?: string }[] }).frontFixtureCalls)
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'list', query: 'to:me@example.test' })]))
    expect(calls.some(c => c.cursor === 'next-message')).toBe(true)
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('fake-front-private-token')
    await page.screenshot({ path: 'test-results/front-native.png' })
    // Prevent even a fake credential from reaching Front if startup beats
    // the test's mock-handler installation after relaunch.
    await page.evaluate(() => window.chatos.disconnectService('front'))
    await app.close(); app = await launchDesktop(env); await mockFront(app); page = await app.firstWindow()
    // A missing OS keychain intentionally makes tokens run-only. Supply the
    // same fake token after restart, not any real credentials or live API call.
    await page.evaluate(() => window.chatos.saveService({ id: 'front', token: 'fake-front-private-token' }))
    await page.reload()
    await expect(page.locator(`[data-tile-id="${readerID}"] .front-message-text`)).toContainText('Your lab results are ready')
    await expect(page.locator('[data-kind="front-list"]')).toHaveCount(2)
    expect(fixture.requests.filter(r => r.method === 'POST')).toEqual([])
  } finally { await app?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})

test('Front API inbox gives clear token guidance instead of silently loading a browser', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-front-missing-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await expect(page.locator('.project-row').first()).toBeVisible()
    await page.getByRole('button', { name: 'Front · API mail inbox', exact: true }).click()
    await expect(page.locator('.front-empty')).toContainText('Save your Front token')
    await expect(page.locator('[data-kind="browser"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Front account settings', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Front API token', exact: true })).toBeVisible()
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
