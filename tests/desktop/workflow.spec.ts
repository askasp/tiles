import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { fixtureServer } from './fixture'
import { launchDesktop } from './launch'

test('V3 messages, permissions, questions, unique browser, linked move, and restart', async () => {
  const fixture = await fixtureServer()
  const profile = await mkdtemp('/tmp/opencode/chatos-workflow-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  try {
    app = await launchDesktop(env)
    let page = await app.firstWindow()
    page.setDefaultTimeout(10_000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.locator('.project-row').first()).toBeVisible()
    await page.getByRole('textbox', { name: 'New session prompt' }).fill('Test the API round trip')
    await page.getByRole('button', { name: 'Start session', exact: true }).click()
    await expect(page.locator('.assistant-message')).toContainText('Fixture response')
    const id = fixture.sessions[0].id
    expect(fixture.requests.find(r => r.path.endsWith('/prompt'))?.body.text).toBe('Test the API round trip')
    fixture.askPermission(id)
    await page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect(page.locator('.permission-card')).toHaveCount(0)
    fixture.askQuestion(id)
    await page.locator('.question-card select').selectOption('device')
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    await expect(page.locator('.question-card')).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Survives a desktop restart')
    await page.keyboard.press('Control+t')
    await page.getByRole('textbox', { name: 'URL', exact: true }).fill(`${fixture.url}/preview`)
    await page.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(page.locator('.resource-tile:visible')).toHaveCount(2)
    await expect.poll(() => app!.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().endsWith('/preview')).length)).toBe(1)
    await app.evaluate(async ({ webContents }) => {
      const c = webContents.getAllWebContents().find(c => c.getURL().endsWith('/preview'))!
      if (await c.executeJavaScript('typeof window.chatos') !== 'undefined') throw new Error('Privileged preload leaked into browser')
      await c.executeJavaScript("localStorage.setItem('move-marker','keep-this-page')")
    })
    const browserID = await page.locator('[data-kind="browser"]').getAttribute('data-tile-id')
    await page.getByRole('button', { name: 'Attach page to session', exact: true }).click()
    await expect(page.locator('.context-chip')).toContainText('Local preview')
    // Moving the session also moves its preview, without reconstructing Chromium.
    await page.locator(`[data-tile-id="${id}"] textarea`).click()
    await page.keyboard.press('Control+Alt+Shift+2')
    await expect(page.locator('.workspace-button.selected')).toContainText('2')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(2)
    await expect(page.locator(`[data-tile-id="${browserID}"]`)).toBeVisible()
    expect(await app.evaluate(async ({ webContents }) => webContents.getAllWebContents().find(c => c.getURL().endsWith('/preview'))!.executeJavaScript("localStorage.getItem('move-marker')"))).toBe('keep-this-page')
    await page.getByRole('button', { name: 'Launcher', exact: true }).click()
    await page.getByRole('textbox', { name: 'Launcher search' }).fill(`${fixture.url}/preview`)
    await page.getByRole('textbox', { name: 'Launcher search' }).press('Enter')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(2)
    expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().endsWith('/preview')).length)).toBe(1)
    await page.getByRole('button', { name: 'Shelf New session', exact: true }).click()
    await expect(page.locator('.resource-tile:visible')).toHaveCount(0)
    fixture.askPermission(id)
    await expect(page.getByRole('button', { name: 'Go to waiting session' })).toContainText('1 waiting')
    await page.getByRole('button', { name: 'Go to waiting session' }).click()
    await expect(page.locator('.resource-tile:visible')).toHaveCount(2)
    await page.getByRole('button', { name: 'Allow once', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Go to waiting session' })).toContainText('All clear')
    await page.screenshot({ path: 'test-results/workflow-v3.png' })
    expect(errors).toEqual([])
    await app.close()
    app = await launchDesktop(env); page = await app.firstWindow()
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue('Survives a desktop restart')
    await expect(page.locator('.context-chip')).toContainText('Local preview')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(2)
  } finally { await app?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
