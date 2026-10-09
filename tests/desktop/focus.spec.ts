import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { ask, desktopReady, launchDesktop } from './launch'

const folderTile = (page: Page, path: string) => page.locator(`[data-resource-key="folder:${path}"]`)
const holdsKeys = (page: Page, path: string) => folderTile(page, path).evaluate(tile => tile.contains(document.activeElement))
const selected = (page: Page, path: string) => folderTile(page, path).locator('.file-entry.selected')

test('Focus: a new tile takes keyboard focus, and j/k follow the focused tile', async () => {
  const profile = await mkdtemp('/tmp/opencode/chatos-focus-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile }
  delete env.ELECTRON_RUN_AS_NODE; delete env.CHATOS_SERVER_URL
  const a = `${profile}/alpha`, b = `${profile}/beta`
  for (const dir of [a, b]) { await mkdir(dir); for (const name of ['1.txt', '2.txt', '3.txt']) await writeFile(`${dir}/${name}`, name) }
  const app = await launchDesktop(env), page = await app.firstWindow()
  const keyErrors: string[] = []
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Tile action key')) keyErrors.push(message.text()) })
  try {
    await desktopReady(page)
    await ask(page, `files ${a}`, false).then(input => input.press('Enter'))
    await expect(folderTile(page, a)).toHaveClass(/tile-focused/)
    await expect.poll(() => holdsKeys(page, a)).toBe(true)

    // A new tile is focused for the keyboard too, not only drawn as focused.
    await ask(page, `files ${b}`, false).then(input => input.press('Enter'))
    await expect(folderTile(page, b)).toHaveClass(/tile-focused/)
    await expect.poll(() => holdsKeys(page, b)).toBe(true)
    await page.keyboard.press('j')
    await expect(selected(page, b)).toContainText('2.txt')
    await expect(selected(page, a)).toContainText('1.txt')

    // Ctrl+W w moves focus; j/k now move the other tile's selection.
    await page.keyboard.press('Control+w'); await page.keyboard.press('w')
    await expect(folderTile(page, a)).toHaveClass(/tile-focused/)
    await expect.poll(() => holdsKeys(page, a)).toBe(true)
    await page.keyboard.press('j'); await page.keyboard.press('j')
    await expect(selected(page, a)).toContainText('3.txt')
    await expect(selected(page, b)).toContainText('2.txt')

    // And back again.
    await page.keyboard.press('Control+w'); await page.keyboard.press('w')
    await expect.poll(() => holdsKeys(page, b)).toBe(true)
    await page.keyboard.press('k')
    await expect(selected(page, b)).toContainText('1.txt')
    await expect(selected(page, a)).toContainText('3.txt')

    // / filters the focused tile; Esc goes back to the list so j/k work again.
    await page.keyboard.press('/')
    await expect(folderTile(page, b).getByRole('textbox', { name: 'Filter folder entries' })).toBeFocused()
    await page.keyboard.type('3'); await page.keyboard.press('Escape')
    await expect(folderTile(page, b).locator('.file-entry')).toHaveCount(1)
    await expect(folderTile(page, b).locator('.file-entry').first()).toBeFocused()
    await expect(selected(page, b)).toContainText('3.txt')

    // ? shows every key; Esc closes it.
    await page.keyboard.press('?')
    await expect(page.getByRole('dialog', { name: 'Keys' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Keys' })).toContainText('Parent folder')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // ␣ opens the leader; t is this tile, whose letters run its actions. Ctrl+O comes back.
    await page.keyboard.press(' ')
    await expect(page.getByRole('dialog', { name: 'Actions · Leader' })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Actions · Leader' }).locator('.action-row').first()).toBeFocused()
    await page.keyboard.press('t')
    const menu = page.getByRole('dialog', { name: 'Actions · beta' })
    await expect(menu.getByRole('button', { name: /Parent folder/ })).toBeVisible()
    await expect(menu.locator('.action-row').first()).toBeFocused()
    await page.keyboard.press('-')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(folderTile(page, profile)).toHaveClass(/tile-focused/)
    await page.keyboard.press('Control+o')
    await expect(folderTile(page, b)).toHaveClass(/tile-focused/)

    // The tile's letters also work bare: - goes up again, Ctrl+O back.
    await page.keyboard.press('-')
    await expect(folderTile(page, profile)).toHaveClass(/tile-focused/)
    await page.keyboard.press('Control+o')
    await expect(folderTile(page, b)).toHaveClass(/tile-focused/)

    // Super+. (Ctrl+Alt+. on Linux) opens the leader from anywhere; w 2 moves the tile to workspace 2.
    await page.keyboard.press('Control+Alt+.')
    await page.keyboard.press('w')
    await expect(page.getByRole('dialog', { name: 'Actions · Tiles (same as Ctrl+W)' })).toBeVisible()
    await page.keyboard.press('2')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.workspace-button.selected')).toContainText('2')
    expect(keyErrors).toEqual([])
  } finally {
    await app.close()
    await rm(profile, { recursive: true, force: true })
  }
})
