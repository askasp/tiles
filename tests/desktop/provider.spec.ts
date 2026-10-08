import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { addConnector, desktopReady, fakeServices, launchDesktop } from './launch'
import { fixtureServer } from './fixture'

test('Slack DM results open one locally named browser tile, reused from any workspace', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-provider-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url, CHATOS_CONNECTOR_URLS: fixture.connectorURLs }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  const dmPages = () => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().includes('/client/T123/D100')).length)
  try {
    // Slack is a built-in connector against the fixture's fake Slack API; its pages are stubbed.
    await desktopReady(page); await fakeServices(app)
    await addConnector(page, 'slack')
    await page.reload(); await desktopReady(page)
    await expect(page.getByRole('button', { name: 'Slack source' })).toBeVisible()
    const open = async (query: string, mode = 'Enter') => {
      await page.getByRole('button', { name: 'Launcher', exact: true }).click()
      const input = page.getByRole('textbox', { name: 'Launcher search' })
      await input.fill(query)
      await expect(page.locator('.launcher-result').first()).toContainText('DM Carl')
      await input.press(mode); await expect(input).toHaveCount(0)
    }
    await open('dm Carl')
    await expect(page.locator('.resource-tile:visible .tile-title')).toHaveText('DM Carl')
    await expect.poll(dmPages).toBe(1)
    await page.keyboard.press('Control+Alt+2')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(0)
    await open('dm Carl', 'Control+Enter')
    await expect(page.locator('.workspace-button.selected')).toContainText('1')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(1)
    await open('dm Carl', 'Shift+Enter')
    await page.getByRole('button', { name: 'Shelf DM Carl', exact: true }).click()
    await open('dm Carl')
    await expect(page.locator('.resource-tile:visible .tile-title')).toHaveText('DM Carl')
    expect(await dmPages()).toBe(1)
    expect(fixture.requests.filter(r => r.method === 'POST')).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
