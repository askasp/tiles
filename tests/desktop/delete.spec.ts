import { test, expect, type ElectronApplication } from '@playwright/test'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { approvals, ask, desktopReady, launchDesktop, tileAction } from './launch'
import { fixtureServer } from './fixture'

/** Answer the next native confirmation(s): 1 = the action button, 0 = Cancel. */
const answer = (app: ElectronApplication, response: 0 | 1) => app.evaluate(({ dialog }, r) => {
  const approved = (globalThis as typeof globalThis & { approved: string[] }).approved ||= []
  dialog.showMessageBox = (async (...args: unknown[]) => { const o = args.at(-1) as { title?: string; detail?: string; buttons?: string[] }; approved.push(`${o.title}\n${o.detail}\n[${o.buttons?.join('|')}]`); return { response: r, checkboxChecked: false } }) as typeof dialog.showMessageBox
}, response)

test('delete a session, hide a project, move a file to the Trash: each asks first and says what goes', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-delete-')
  // Linux has no Trash on /tmp, so the files sit in a temporary folder on the home disk, with
  // their own Trash inside it (XDG_DATA_HOME): your real Trash is never used. All removed after.
  await mkdir(`${homedir()}/.cache`, { recursive: true })
  const scratch = await mkdtemp(`${homedir()}/.cache/chatos-delete-test-`), work = `${scratch}/work`
  await mkdir(work); await writeFile(`${work}/old-notes.txt`, 'bye'); await writeFile(`${work}/keep.txt`, 'stay')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url, XDG_DATA_HOME: `${scratch}/xdg` }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page, { opencode: true })
    const k = await ask(page, 'chatos', false)
    await page.locator('.launcher-result').filter({ hasText: 'OpenCode project' }).first().click()
    await expect(k).toHaveCount(0)
    const list = page.locator('[data-kind="project"].tile-focused')
    const listID = await list.getAttribute('data-tile-id'), tile = page.locator(`[data-tile-id="${listID}"]`)

    // Cancel changes nothing.
    await answer(app, 0)
    await tile.locator('.session-row').filter({ hasText: 'Consent tests' }).focus()
    await tileAction(page, tile, 'Delete session “Consent tests”…')
    await expect(tile.locator('.session-row').filter({ hasText: 'Consent tests' })).toHaveCount(1)
    expect(fixture.requests.filter(r => r.method === 'DELETE')).toEqual([])
    // Approve: OpenCode deletes it for good, and the warning said so.
    await answer(app, 1)
    await tileAction(page, tile, 'Delete session “Consent tests”…')
    await expect(tile.locator('.session-row').filter({ hasText: 'Consent tests' })).toHaveCount(0)
    expect(fixture.requests.filter(r => r.method === 'DELETE').map(r => r.path)).toEqual(['/api/session/ses_fixture_3'])
    expect((await approvals(app)).at(-1)).toMatch(/Delete “Consent tests”\?[\s\S]*no undo[\s\S]*\[Cancel\|Delete\]/)

    // A session opened in place of the list, with an unsent message: the warning says so, and the tile goes back to the list.
    await tile.locator('.session-row').filter({ hasText: 'Consent reload' }).focus()
    await page.keyboard.press('Enter')
    await expect(tile).toHaveAttribute('data-kind', 'session')
    await tile.locator('textarea').fill('never sent')
    await tileAction(page, tile, 'Delete this session…')
    await expect(tile).toHaveAttribute('data-kind', 'project')
    expect((await approvals(app)).at(-1)).toContain('unsent message')
    await expect(tile.locator('.session-row').filter({ hasText: 'Consent reload' })).toHaveCount(0)

    // Hide the project: its tile closes, the projects list no longer has it, OpenCode is untouched.
    await tileAction(page, tile, 'Hide project “chatos” from ChatOS')
    await expect(tile).toHaveCount(0)
    await ask(page, 'opencode projects')
    const projects = page.locator('[data-kind="projects"]:visible')
    await expect(projects.locator('.recipe-list-row')).toHaveCount(1)
    await expect(projects.locator('.recipe-list-row')).toContainText('health')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Show chatos', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Show chatos', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(projects.locator('.recipe-list-row')).toHaveCount(2)
    expect(fixture.requests.filter(r => r.method === 'DELETE')).toHaveLength(2)

    // Files: the selected entry goes to the Trash, after asking. The other file stays.
    await ask(page, work)
    const files = page.locator(`[data-resource-key="folder:${work}"]`)
    await expect(files.locator('.file-entry')).toHaveCount(2)
    await files.locator('.files-entries').focus()
    await page.keyboard.press('ArrowDown')
    await expect(files.locator('.file-entry.selected')).toContainText('old-notes.txt')
    const name = 'old-notes.txt'
    await tileAction(page, files, `Move “${name}” to the Trash…`)
    await expect(files.locator('.file-entry')).toHaveCount(1)
    await expect(files.locator('.file-entry')).toContainText('keep.txt')
    await expect(access(`${work}/${name}`)).rejects.toThrow()
    await access(`${scratch}/xdg/Trash/files/${name}`)
    expect((await approvals(app)).at(-1)).toMatch(/Move “.+” to the Trash\?[\s\S]*restore it from the Trash[\s\S]*\[Cancel\|Move to Trash\]/)
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }); await rm(scratch, { recursive: true, force: true }) }
})
