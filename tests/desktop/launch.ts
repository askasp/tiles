import { _electron as electron, expect, type Page } from '@playwright/test'
import { createRequire } from 'node:module'

export function launchDesktop(env: Record<string, string>) {
  const require = createRequire(import.meta.url)
  return electron.launch({
    executablePath: require('electron') as string,
    // Playwright defaults this to false and otherwise silently adds --no-sandbox.
    // Test the exact installed Electron binary and security settings users run.
    chromiumSandbox: true,
    args: ['.'], cwd: process.cwd(), env,
  })
}

/** A fresh profile opens K in model setup. Skip it unless the test sets up a model. */
export async function desktopReady(page: Page, options: { opencode?: boolean } = {}) {
  const root = page.locator('.tile-app[data-model-state]:not([data-model-state="loading"])')
  await expect(root).toBeVisible({ timeout: 20_000 })
  if (await root.getAttribute('data-model-state') === 'setup') {
    await page.getByRole('button', { name: /^Skip for now/ }).click()
    await expect(page.locator('[data-model-setup]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Launcher' })).toHaveCount(0)
  }
  if (options.opencode) await expect(page.locator('[aria-label="OpenCode source"] .status-dot.green')).toBeVisible({ timeout: 20_000 })
}

/** K: type, wait for the first result, run it. */
export async function ask(page: Page, query: string, press = true) {
  // A K that is still running its last action closes on its own; don't type into it.
  await expect(page.locator('.k-status').filter({ hasText: 'Opening' })).toHaveCount(0)
  if (!await page.getByRole('textbox', { name: 'Launcher search' }).isVisible()) await page.getByRole('button', { name: 'Launcher', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Launcher search' })
  await input.fill(query)
  if (press) { await expect(page.locator('.launcher-result').first()).toBeVisible(); await input.press('Enter') }
  return input
}

/** C3: start an OpenCode session from K, optionally with a first message. */
export async function startSession(page: Page, project: string, message?: string) {
  const input = await ask(page, `start session in ${project}${message ? `: ${message}` : ''}`, false)
  await expect(page.locator('.launcher-result').first()).toContainText(`Start session in ${project}`)
  await input.press('Enter')
}
