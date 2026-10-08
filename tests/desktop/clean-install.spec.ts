import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { ask, desktopReady, launchDesktop } from './launch'
import { fixtureServer } from './fixture'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

test('clean install: model first, built-ins without any server, OpenCode only once added, and it survives restarts', async () => {
  test.setTimeout(120_000)
  const fixture = await fixtureServer()
  const profile = await mkdtemp('/tmp/opencode/chatos-clean-')
  // An isolated home: folder search, terminals and OpenCode discovery never see the real one.
  const home = await mkdtemp('/tmp/opencode/chatos-clean-home-')
  await mkdir(`${home}/code/clean-slate-folder/assets`, { recursive: true })
  await writeFile(`${home}/code/clean-slate-folder/assets/pixel.png`, png)
  await writeFile(`${home}/code/clean-slate-folder/README.md`, 'CLEAN-SLATE-README')
  await writeFile(`${home}/.zshrc`, ''); await writeFile(`${home}/.bashrc`, '') // No first-run shell wizards.
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, HOME: home, XDG_STATE_HOME: `${home}/.local/state` }
  delete env.ELECTRON_RUN_AS_NODE; delete env.CHATOS_SERVER_URL
  let app: ElectronApplication | undefined
  try {
    app = await launchDesktop(env)
    let page = await app.firstWindow()
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    // A0: the only first-launch question. Nothing else is preinstalled.
    await expect(page.locator('[data-model-setup]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use a local model instead' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-model-setup]')).toBeVisible() // K needs an answer: connect or skip.
    await desktopReady(page)
    await expect(page.getByRole('region', { name: 'Empty desktop' })).toBeVisible()
    await expect(page.locator('.source-status')).toHaveCount(0)
    expect(await page.evaluate(() => window.chatos.services())).toEqual(expect.not.arrayContaining([expect.objectContaining({ configured: true })]))

    // Keyboard only: Tab walks the built-in sources, then lands on Add source.
    let k = await ask(page, '', false)
    await expect(page.locator('.launcher-result').filter({ hasText: 'Add a source' })).toHaveCount(1)
    for (const name of ['Browser', 'Files', 'Terminal']) { await k.press('Tab'); await expect(page.locator('.k-scope')).toContainText(name) }
    await k.press('Tab')
    await expect(k).toHaveValue('add ')
    await expect(page.locator('.launcher-result').first()).toContainText('Add OpenCode')
    await page.keyboard.press('Escape')

    // A3: before any service is connected, the name finds the folder; → offers a terminal there.
    let input = await ask(page, 'clean-slate', false)
    const folder = page.locator('.launcher-result').first()
    await expect(folder).toContainText('Browse files')
    await expect(folder).toContainText('~/code/clean-slate-folder')
    await expect(page.locator('.launcher-result').filter({ hasText: 'OpenCode' })).toHaveCount(0)
    await input.press('ArrowRight')
    await expect(page.locator('.launcher-result').filter({ hasText: 'Open terminal here' })).toHaveCount(1)
    await input.press('ArrowLeft')
    await input.press('Enter')
    const files = page.locator('[data-kind="folder"]:visible')
    await expect(files.locator('.file-entry')).toHaveCount(2)
    await expect(files.getByRole('button', { name: 'Show OpenCode sessions' })).toHaveCount(0)
    await expect(page.locator('.workspace-button.selected')).toContainText('clean-slate-folder')

    k = await ask(page, 'pixel', false)
    await expect(page.locator('.launcher-result').first()).toContainText('~/code/clean-slate-folder/assets/pixel.png')
    await page.keyboard.press('Escape')
    // Files picks the viewer: images render as images.
    await files.locator('.file-entry').filter({ hasText: 'assets' }).click()
    await page.locator('[data-kind="folder"]:visible .file-entry').filter({ hasText: 'pixel.png' }).click()
    await expect(page.locator('[data-kind="file"]:visible .image-preview img')).toBeVisible()

    // A5: a terminal opens in the focused tile's folder.
    await page.locator('[data-kind="file"]:visible').click()
    input = await ask(page, 'terminal', false)
    await expect(page.locator('.launcher-result').first()).toContainText('the focused folder')
    await input.press('Enter')
    const terminal = page.locator('[data-kind="terminal"]:visible')
    await expect(terminal.locator('.xterm')).toBeVisible()
    await expect(terminal.locator('.files-footer')).toContainText(`${home}/code/clean-slate-folder/assets`)
    await terminal.locator('.terminal-host').click()
    await page.keyboard.type('echo "pwd=$(pwd)"\n')
    await expect(terminal.locator('.xterm-rows')).toContainText(`pwd=${home}/code/clean-slate-folder/assets`)
    // Plain Ctrl chords belong to the shell (Ctrl+W deletes a word), not to tile management.
    await page.keyboard.type('echo one two'); await page.keyboard.press('Control+w'); await page.keyboard.press('Enter')
    await expect(terminal.locator('.xterm-rows')).toContainText('echo one')
    await expect(terminal.locator('.xterm-rows')).not.toContainText('two')
    await expect(page.locator('[data-kind="terminal"]:visible')).toHaveCount(1)
    expect(errors).toEqual([])

    // B: OpenCode is added by asking, here by URL. Nothing contacted it before this.
    expect(fixture.requests).toEqual([])
    input = await ask(page, 'add opencode', false)
    await expect(page.locator('[data-opencode-setup]')).toContainText('OpenCode isn’t')
    await page.getByRole('button', { name: 'Connect to a server URL' }).click()
    await page.getByRole('textbox', { name: 'Server URL' }).fill(fixture.url)
    await page.getByRole('textbox', { name: 'Server URL' }).press('Enter')
    await expect(page.locator('[data-opencode-setup="connected"]')).toContainText('It has 2 projects')
    await expect(page.locator('.k-map')).toContainText('Session tile')
    await page.keyboard.press('Enter')
    await desktopReady(page, { opencode: true })
    expect(fixture.requests.filter(r => r.method !== 'GET')).toEqual([])

    // Restart: the source, layout and running-shell placeholder come back; no model question again.
    await app.close()
    app = await launchDesktop(env); page = await app.firstWindow()
    await desktopReady(page, { opencode: true })
    await expect(page.locator('[data-model-setup]')).toHaveCount(0)
    await expect(page.locator('[data-kind="terminal"]')).toHaveCount(1)
    await expect(page.locator('[data-kind="folder"]')).toHaveCount(2)

    // Remove OpenCode: it stops being contacted, and stays gone after restart.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('region', { name: 'Sources' }).getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('OpenCode removed')
    await page.getByRole('button', { name: 'Close settings' }).click()
    await expect(page.getByRole('button', { name: 'OpenCode source' })).toHaveCount(0)
    await app.close()
    const before = fixture.requests.length
    app = await launchDesktop(env); page = await app.firstWindow()
    await desktopReady(page)
    await page.waitForTimeout(1500)
    await expect(page.getByRole('button', { name: 'OpenCode source' })).toHaveCount(0)
    expect(fixture.requests.length).toBe(before)
  } finally { await app?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }) }
})

test('K can use a model OpenCode is signed into (e.g. a ChatGPT subscription) instead of an API key', async () => {
  const definition = { ...(await import('../../src/shared/connectors')).exampleConnector, baseURL: 'https://api.helpdesk.example' }
  const fixture = await fixtureServer({ generate: prompt => prompt.startsWith('You are K') ? JSON.stringify({ kind: 'connector', text: 'Helpdesk tickets.', definition }) : '{}' })
  const profile = await mkdtemp('/tmp/opencode/chatos-subscription-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  let app: ElectronApplication | undefined
  try {
    app = await launchDesktop(env)
    let page = await app.firstWindow()
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox })
    await expect(page.locator('[data-model-setup]')).toBeVisible()
    await page.getByRole('button', { name: 'Use your ChatGPT subscription' }).click()
    await expect(page.getByRole('combobox', { name: 'OpenCode model' })).toHaveValue('fixture/test-model')
    await page.getByRole('textbox', { name: 'Launcher search' }).press('Enter')
    await expect(page.getByRole('button', { name: 'Model', exact: true })).toContainText('test-model')
    const input = await ask(page, 'add helpdesk', false)
    await input.press('Enter')
    await expect(page.locator('.k-map')).toContainText('Ticket inbox')
    const generate = fixture.requests.find(r => r.path.endsWith('/generate'))!
    expect(JSON.stringify(generate.body)).toContain('"providerID":"fixture"')
    expect(fixture.requests.filter(r => r.path.endsWith('/api/session') && r.method === 'POST')).toEqual([])
    // Restart: the choice is remembered and becomes ready once OpenCode reconnects.
    await app.close(); app = await launchDesktop(env); page = await app.firstWindow()
    await desktopReady(page, { opencode: true })
    await expect(page.locator('[aria-label="Model"] .status-dot.green')).toBeVisible()
  } finally { await app?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
