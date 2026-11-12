import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { ask, desktopReady, launchDesktop } from './launch'

test('Ctrl+W is the tile prefix inside a terminal too, and Ctrl+W ; hands the shell its own Ctrl+W', async () => {
  const profile = await mkdtemp('/tmp/chatos-terminal-keys-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, SHELL: '/bin/bash' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env)
  try {
    const page = await app.firstWindow()
    await desktopReady(page)
    await page.keyboard.press('Control+Alt+.'); await page.keyboard.press('n'); await page.keyboard.press('t')
    const terminal = page.locator('[data-kind="terminal"].tile-focused')
    await expect(terminal.locator('.xterm')).toBeVisible()
    await terminal.locator('.terminal-host').click()
    const screen = terminal.locator('.xterm-rows')
    await expect(screen).toContainText('$', { timeout: 15_000 })

    // Ctrl+W waits for its second key here too; Escape gives up without touching the shell.
    await page.keyboard.press('Control+w'); await expect(page.locator('.chord-hint')).toBeVisible()
    await page.keyboard.press('Escape'); await expect(page.locator('.chord-hint')).toHaveCount(0)

    // Ctrl+W ; is the shell's own Ctrl+W: it deletes “two”.
    await page.keyboard.type('echo one two')
    await page.keyboard.press('Control+w'); await page.keyboard.press(';')
    await page.keyboard.type('three'); await page.keyboard.press('Enter')
    await expect(screen).toContainText(/^one three\s*$/m, { useInnerText: true })
    await expect(screen).not.toContainText('one two')

    // Real keys reach the main process first, which Playwright's keyboard skips: the same through sendInputEvent.
    const send = (keyCode: string, modifiers: string[] = []) => app.evaluate(({ BrowserWindow }, [k, m]) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m as Electron.InputEvent['modifiers'] })
      if (!m.includes('control')) contents.sendInputEvent({ type: 'char', keyCode: k, modifiers: m as Electron.InputEvent['modifiers'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m as Electron.InputEvent['modifiers'] })
    }, [keyCode, modifiers] as const)
    await page.keyboard.type('echo four five')
    await send('w', ['control']); await expect(page.locator('.chord-hint')).toBeVisible()
    await send(';')
    await page.keyboard.type('six'); await page.keyboard.press('Enter')
    await expect(screen).toContainText(/^four six\s*$/m, { useInnerText: true })

    // Ctrl+W 2 from inside the terminal sends it to workspace 2 (and you go with it), like i3's mod+Shift+2.
    const id = await terminal.getAttribute('data-tile-id')
    await page.keyboard.press('Control+w'); await page.keyboard.press('2')
    await expect(page.locator('.workspace-button.selected kbd')).toContainText('2')
    await expect(page.locator(`[data-tile-id="${id}"].tile-focused`)).toBeVisible()
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})

test('K: “terminal” goes back to the shell you have running; “new terminal” starts another', async () => {
  const profile = await mkdtemp('/tmp/chatos-terminal-reopen-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, SHELL: '/bin/sh' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env)
  try {
    const page = await app.firstWindow()
    await desktopReady(page)
    const terminals = page.locator('.resource-tile[data-kind="terminal"]')
    // Nothing running yet: “terminal” opens one.
    await ask(page, 'terminal', false)
    await expect(page.locator('.launcher-result.selected')).toContainText('Open terminal')
    await page.keyboard.press('Enter')
    await expect(terminals.locator('.xterm')).toBeVisible()
    const id = await terminals.getAttribute('data-tile-id')
    // Hidden, the shell keeps running: “terminal” brings that one back, not a new one.
    await page.keyboard.press('Control+w'); await page.keyboard.press('q')
    await expect(page.locator('.resource-tile[data-kind="terminal"]:visible')).toHaveCount(0)
    await ask(page, 'terminal', false)
    await expect(page.locator('.launcher-result.selected')).toContainText('Bring back')
    await page.keyboard.press('Enter')
    await expect(page.locator(`[data-tile-id="${id}"].tile-focused`)).toBeVisible()
    await expect(terminals).toHaveCount(1)
    // Asked for a new one: a new one.
    await ask(page, 'new terminal', false)
    await expect(page.locator('.launcher-result.selected')).toContainText('Open terminal')
    await page.keyboard.press('Enter')
    await expect(terminals).toHaveCount(2)
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
