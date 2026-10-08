import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { launchDesktop } from './launch'
import { fixtureServer } from './fixture'

test('provider results open unique locally named browser tiles and keep owner navigation', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-provider-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    // Test only the renderer/IPC handoff here; ProviderSearch tests exercise
    // mocked HTTPS data. Never use real credentials or mutate provider objects.
    await app.evaluate(({ ipcMain }, url) => {
      ipcMain.removeHandler('chatos:searchServices')
      ipcMain.handle('chatos:searchServices', (_event, query: string) => query === 'dm Carl' ? {
        resources: [{ service: 'slack', title: 'DM Carl', url: `${url}/preview/opaque-dm`, description: 'Existing DM' }],
      } : { resources: [], error: 'No matching source resources.' })
    }, fixture.url)
    await expect(page.locator('.project-row').first()).toBeVisible()
    const open = async (query: string, mode = 'Enter') => {
      await page.getByRole('button', { name: 'Launcher', exact: true }).click()
      const input = page.getByRole('textbox', { name: 'Launcher search' })
      await input.fill(query)
      await expect(page.locator('.launcher-result').first()).toContainText(query.replace(/^dm /, 'DM '))
      await input.press(mode); await expect(input).toHaveCount(0)
    }
    await open('dm Carl')
    await expect(page.locator('.resource-tile:visible .tile-title')).toHaveText('DM Carl')
    await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().endsWith('/opaque-dm')).length)).toBe(1)
    await page.keyboard.press('Control+Alt+2')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(0)
    await open('dm Carl', 'Control+Enter')
    await expect(page.locator('.workspace-button.selected')).toContainText('1')
    await expect(page.locator('.resource-tile:visible')).toHaveCount(1)
    await open('dm Carl', 'Shift+Enter')
    await page.getByRole('button', { name: 'Shelf DM Carl', exact: true }).click()
    await open('dm Carl')
    await expect(page.locator('.resource-tile:visible .tile-title')).toHaveText('DM Carl')
    expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(c => c.getURL().endsWith('/opaque-dm')).length)).toBe(1)
    expect(fixture.requests.filter(r => r.method === 'POST')).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
