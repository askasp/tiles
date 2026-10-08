import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { approvals, ask, desktopReady, fakeServices, launchDesktop } from './launch'
import { fixtureServer } from './fixture'

/** Front is a built-in connector, pointed at the fixture's fake Front API. No real account. */
test('add Front from K, read filtered mail, comment and reply with confirmation, survive a restart', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-front-native-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url, CHATOS_CONNECTOR_URLS: fixture.connectorURLs }
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  try {
    app = await launchDesktop(env); await fakeServices(app)
    let page = await app.firstWindow()
    await desktopReady(page)
    // D1: “add front” shows Front straight away — it ships with ChatOS, no model involved.
    const k = await ask(page, 'add front', false)
    await expect(page.locator('[data-connector-setup="front"] .k-map')).toContainText('List of inbox')
    await expect(page.locator('[data-connector-setup="front"] .k-map')).toContainText('Reply (asks)')
    await k.press('Enter')
    await page.getByRole('textbox', { name: 'Connector token' }).fill('fake-front-private-token')
    await page.getByRole('textbox', { name: 'Connector token' }).press('Enter')
    await expect(page.locator('[data-connector-setup="front"]')).toContainText('Connected as me@example.test')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Front source' })).toBeVisible()

    // Personal filters need your teammate ID once; then they're presets and K results.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('summary').filter({ hasText: 'Front' }).click()
    await page.getByRole('textbox', { name: 'Front Your email' }).fill('me@example.test')
    await page.getByRole('textbox', { name: 'Front Your teammate ID' }).fill('tea_123')
    await page.getByRole('textbox', { name: 'Front A tag to follow' }).fill('tag_me')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('.source-row-details [role="status"]')).toContainText('Saved')
    await page.getByRole('button', { name: 'Close settings', exact: true }).click()

    await ask(page, 'front tagged', false)
    await expect(page.locator('.launcher-result').first()).toContainText('Front · Tagged')
    await page.getByRole('textbox', { name: 'Launcher search' }).press('Enter')
    const inbox = page.locator('[data-kind="recipe"].tile-focused')
    await expect(inbox.locator('.recipe-list-row')).toHaveCount(3)
    await inbox.getByRole('button', { name: 'Addressed to me', exact: true }).click()
    const addressed = page.locator('[data-kind="recipe"].tile-focused')
    await expect(addressed.locator('.recipe-list-row')).toHaveCount(1)
    await addressed.locator('.recipe-list-row').filter({ hasText: 'Lab reply' }).click()

    const reader = page.locator('[data-kind="recipe"].tile-focused')
    await expect(reader.locator('.recipe-message')).toContainText('Your lab results are ready')
    await expect(reader).toContainText('📎 results.txt')
    await expect(reader).not.toContainText('secret-attachment')
    await expect(reader.locator('script, img, iframe')).toHaveCount(0)
    const draft = reader.getByRole('textbox', { name: 'Resource action draft' })
    await draft.fill('Called Carl, all good.')
    await reader.getByRole('button', { name: /^Comment/ }).click()
    await expect(draft).toHaveValue('')
    await expect(reader.locator('.recipe-message-note')).toContainText('Called Carl, all good.')
    await draft.fill('Thanks, the results look fine.')
    await reader.getByRole('button', { name: /^Reply/ }).click()
    await expect(draft).toHaveValue('')
    expect(fixture.frontWrites).toEqual([{ id: 'cnv_123', kind: 'comment', body: 'Called Carl, all good.' }, { id: 'cnv_123', kind: 'reply', body: 'Thanks, the results look fine.' }])
    // Each write asked first and showed the exact body, sent as you.
    const asked = (await approvals(app)).filter(a => a.startsWith('Confirm'))
    expect(asked).toHaveLength(2)
    expect(asked[1]).toContain('{"body":"Thanks, the results look fine.","author_id":"tea_123"}')
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('fake-front-private-token')
    const readerID = await reader.getAttribute('data-tile-id')
    await page.screenshot({ path: 'test-results/front-native.png' })

    // Restart: Front is still added; without an OS keyring the token was for that run only.
    await app.close(); app = await launchDesktop(env); await fakeServices(app); page = await app.firstWindow()
    await desktopReady(page)
    await page.evaluate(() => window.chatos.connectorToken('front', 'fake-front-private-token'))
    await page.reload()
    await expect(page.locator(`[data-tile-id="${readerID}"] .recipe-message`).first()).toContainText('Your lab results are ready', { timeout: 20_000 })
    expect(fixture.frontWrites).toHaveLength(2)
  } finally { await app?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})

test('Front is not a source until added: mail queries offer to add it instead of loading anything', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-front-missing-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url, CHATOS_CONNECTOR_URLS: fixture.connectorURLs }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page)
    const input = await ask(page, 'mail is:open', false)
    await expect(page.locator('.launcher-result').first()).toContainText('Add Front')
    await input.press('Enter')
    await expect(input).toHaveValue('add front')
    await expect(page.locator('[data-connector-setup="front"]')).toContainText('ships with ChatOS')
    await expect(page.locator('[data-kind="browser"], [data-kind="recipe"]')).toHaveCount(0)
    expect(fixture.requests.filter(r => r.path.startsWith('/front'))).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
