import { test, expect } from '@playwright/test'
import { createServer } from 'vite'
import { mkdtemp, rm } from 'node:fs/promises'
import config from '../../electron.vite.config'
import { fixtureServer } from './fixture'
import { launchDesktop } from './launch'

test('development renderer loads with React Fast Refresh and sandboxed preload', async () => {
  const fixture = await fixtureServer()
  const profile = await mkdtemp('/tmp/opencode/chatos-dev-')
  const vite = await createServer({ ...config.renderer, configFile: false, mode: 'development', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await vite.listen()
  const url = vite.resolvedUrls!.local[0]
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url, ELECTRON_RENDERER_URL: url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env)
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.locator('.project-row').first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'New session prompt' })).toBeVisible()
    await page.screenshot({ path: 'test-results/dev-home.png' })
    expect(errors).toEqual([])
  } finally {
    await app.close(); await vite.close(); await fixture.close()
    await rm(profile, { recursive: true, force: true })
  }
})
