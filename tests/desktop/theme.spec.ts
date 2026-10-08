import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { desktopReady, launchDesktop } from './launch'

const background = (page: import('@playwright/test').Page, selector: string) => page.locator(selector).first().evaluate(e => getComputedStyle(e).backgroundColor)

test('Appearance: dark is chosen in Settings, survives a restart, and tiles stand out from the desktop', async () => {
  const profile = await mkdtemp('/tmp/opencode/chatos-theme-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE; delete env.CHATOS_SERVER_URL
  let app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page)
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    const light = await background(page, 'html')
    expect(await background(page, '.resource-tile')).not.toBe(light)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(() => background(page, 'html')).not.toBe(light)
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
    await app.close()
    app = await launchDesktop(env); page = await app.firstWindow()
    await desktopReady(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  } finally { await app.close(); await rm(profile, { recursive: true, force: true }) }
})
