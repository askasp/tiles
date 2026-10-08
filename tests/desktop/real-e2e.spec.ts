import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { launchDesktop } from './launch'

/**
 * A fresh install against real services on this machine. Opt in: CHATOS_REAL_E2E=1
 *   CHATOS_MODEL_URL  (default http://127.0.0.1:8085/v1) — an OpenAI-compatible local model
 * Uses the running OpenCode service and creates ONE session in a temp folder with a
 * “reply pong, use no tools” prompt. Reads a public, no-auth API (JSONPlaceholder).
 */
test.skip(!process.env.CHATOS_REAL_E2E, 'Set CHATOS_REAL_E2E=1 to run against real services')

test('fresh install, real model, real OpenCode, real API, vim window keys', async () => {
  test.setTimeout(600_000)
  const profile = await mkdtemp('/tmp/opencode/chatos-real-'), scratch = await mkdtemp('/tmp/opencode/chatos-real-scratch-')
  await mkdir(`${scratch}/notes`); await writeFile(`${scratch}/notes/todo.md`, '- try ChatOS'); await writeFile(`${scratch}/README.md`, 'scratch')
  const shots = process.env.CHATOS_SHOTS || 'test-results/real-e2e'
  await mkdir(shots, { recursive: true })
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE; delete env.CHATOS_SERVER_URL
  const timings: Record<string, number> = {}
  const time = async <T,>(name: string, run: () => Promise<T>) => { const start = Date.now(); try { return await run() } finally { timings[name] = Date.now() - start } }
  let app: ElectronApplication | undefined
  try {
    app = await launchDesktop(env)
    const page = await app.firstWindow()
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await app.evaluate(({ BrowserWindow, dialog }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1440, 900)
      // Stands in for clicking Approve in the native confirmation dialogs.
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    })
    const k = page.getByRole('textbox', { name: 'Launcher search' })
    const shot = (name: string) => page.screenshot({ path: `${shots}/${name}.png` })

    // A0: the model.
    await expect(page.locator('[data-model-setup]')).toBeVisible({ timeout: 20_000 })
    await shot('a0-first-launch')
    await page.getByRole('textbox', { name: 'Model base URL' }).fill(process.env.CHATOS_MODEL_URL || 'http://127.0.0.1:8085/v1')
    await time('model-probe', () => expect(page.locator('[data-model-setup]')).toContainText(/✓ \d+ local models? found/, { timeout: 30_000 }))
    await shot('a0-model-found')
    await k.press('Enter')
    await expect(page.locator('.k-reply')).toContainText('Ready.')
    await shot('a1-ready')

    // A3: the clean-install search finds this machine's folder.
    await k.fill('chatos')
    await time('k-folder', () => expect(page.locator('.launcher-result').first()).toContainText('Browse files', { timeout: 15_000 }))
    await shot('a3-search')

    // Any API: K builds a connector with the local model.
    await k.fill('add jsonplaceholder')
    await k.press('Enter')
    await time('ai-connector', () => expect(page.locator('.k-map, .k-reply').first()).toBeVisible({ timeout: 240_000 }))
    await expect(page.locator('[data-connector-setup]')).not.toContainText('Looking up', { timeout: 240_000 })
    await shot('d2-ai-connector')
    const proposed = await page.locator('.k-map').count()
    console.log('REAL connector reply:', (await page.locator('[data-connector-setup] .k-reply').allTextContents()).join(' | ').slice(0, 400))
    if (proposed) {
      await k.press('Enter')
      await expect(page.locator('[data-connector-setup] p[role="status"]')).toContainText('Mapping kept', { timeout: 20_000 })
      const openCollection = page.locator('[data-connector-setup] button').filter({ hasText: /^Open / }).first()
      await openCollection.click()
      await time('connector-rows', () => expect(page.locator('[data-kind="recipe"]:visible').locator('.recipe-list-row, .recipe-table tbody tr, .recipe-timeline-row').first()).toBeVisible({ timeout: 30_000 }))
      await shot('d3-connector-tile')
    }

    // B: OpenCode, added by asking.
    if (!await k.isVisible()) await page.getByRole('button', { name: 'Launcher', exact: true }).click()
    await k.fill('add opencode')
    await expect(page.locator('[data-opencode-setup]')).toContainText(/found|installed/, { timeout: 20_000 })
    await shot('b1-add-opencode')
    await page.getByRole('button', { name: /Connect to the running service|Start the background service/ }).first().click()
    await time('opencode-connect', () => expect(page.locator('[data-opencode-setup="connected"]')).toBeVisible({ timeout: 60_000 }))
    await shot('b2-opencode-connected')
    await k.press('Enter')
    await expect(page.locator('[aria-label="OpenCode source"] .status-dot.green')).toBeVisible()

    // C1: the same name, now three different things.
    await page.getByRole('button', { name: 'Launcher', exact: true }).click()
    await k.fill('chatos')
    await expect(page.locator('.launcher-result').filter({ hasText: 'OpenCode project' }).first()).toBeVisible({ timeout: 15_000 })
    await shot('c1-search-again')
    await page.keyboard.press('Escape')

    // Files in a scratch folder: navigate in place, back, open beside.
    await page.getByRole('button', { name: 'Launcher', exact: true }).click()
    await k.fill(scratch); await k.press('Enter')
    const files = page.locator(`[data-resource-key="folder:${scratch}"]`)
    await expect(files.locator('.file-entry')).toHaveCount(2)
    const filesID = await files.getAttribute('data-tile-id')
    const tile = page.locator(`[data-tile-id="${filesID}"]`)
    await tile.locator('.files-entries').focus()
    await page.keyboard.press('l')
    await expect(tile).toHaveAttribute('data-resource-key', `folder:${scratch}/notes`)
    await page.keyboard.press('l')
    await expect(tile).toHaveAttribute('data-resource-key', `file:${scratch}/notes/todo.md`)
    await expect(tile.locator('.file-preview')).toContainText('try ChatOS')
    await page.keyboard.press('h'); await page.keyboard.press('h')
    await expect(tile).toHaveAttribute('data-resource-key', `folder:${scratch}`)
    await shot('a4-files')

    // C3/C4: one real session in the scratch folder, started from the folder's action key.
    await tile.locator('.files-entries').focus()
    await page.keyboard.press('n')
    const session = page.locator('[data-kind="session"].tile-focused')
    await expect(session.locator('textarea')).toBeVisible({ timeout: 30_000 })
    await session.locator('textarea').fill('Reply with exactly the word pong. Do not use any tools.')
    await session.locator('textarea').press('Enter')
    await time('session-reply', () => expect(session.locator('.assistant-message').last()).toContainText(/pong/i, { timeout: 180_000 }))
    await shot('c4-session')

    // Vim window keys between the tiles.
    const focused = () => page.locator('.resource-tile.tile-focused').getAttribute('data-tile-id')
    const sessionID = await session.getAttribute('data-tile-id')
    await page.locator(`[data-tile-id="${sessionID}"] .chat-scroll`).click()
    await page.keyboard.press('Control+w'); await page.keyboard.press('h')
    await expect.poll(focused).not.toBe(sessionID)
    const left = await focused()
    // Spatial, like i3/vim: “right” of the big left tile is the nearest tile on the right.
    await page.keyboard.press('Control+w'); await page.keyboard.press('l')
    await expect.poll(focused).not.toBe(left)
    // Ctrl+W w cycles through every tile and comes back.
    const count = await page.locator('.resource-tile:visible').count(), start = await focused()
    for (let n = 0; n < count; n++) { await page.keyboard.press('Control+w'); await page.keyboard.press('w') }
    await expect.poll(focused).toBe(start)
    await shot('e-window-keys')
    expect(errors).toEqual([])
  } finally {
    console.log('REAL timings ms', JSON.stringify(timings))
    await app?.close(); await rm(profile, { recursive: true, force: true }); await rm(scratch, { recursive: true, force: true })
  }
})
