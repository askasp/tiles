import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises'
import { launchDesktop } from './launch'
import { fixtureServer } from './fixture'

async function search(page: Page, query: string) {
  await page.getByRole('button', { name: 'Launcher', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Launcher search' })
  await input.fill(query)
  return input
}

test('universal search separates Files/OpenCode and only explicit actions create sessions', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-source-ui-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await expect(page.locator('.project-row').first()).toBeVisible()
    let input = await search(page, 'open chatos')
    const folderResult = page.locator('.launcher-result').filter({ hasText: 'Files · Folder · Browse files' }).filter({ has: page.locator('strong', { hasText: /^chatos$/ }) })
    const projectResult = page.locator('.launcher-result').filter({ hasText: 'OpenCode · Project · Show sessions' }).filter({ has: page.locator('strong', { hasText: /^chatos$/ }) })
    await expect(folderResult).toHaveCount(1); await expect(projectResult).toHaveCount(1)
    await expect(page.locator('.launcher-result').filter({ hasText: 'Create session' })).toHaveCount(0)
    await projectResult.click()
    const project = page.locator('[data-kind="project"]:visible')
    await expect(project.getByRole('button', { name: 'Browse files', exact: true })).toBeVisible()
    input = await search(page, 'chatos')
    await expect(page.locator('.launcher-result').first()).toContainText('OpenCode · Project · Show sessions')
    await input.fill('opencode'); await input.press('Enter')
    await expect(input).toHaveValue('')
    await expect(page.getByRole('button', { name: 'OpenCode', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await input.fill('chatos')
    await expect(page.locator('.launcher-result').filter({ hasText: 'Files ·' })).toHaveCount(0)
    await input.fill(''); await input.press('Backspace')
    await expect(page.getByRole('button', { name: 'All sources', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await input.fill('Browse the chatos files.')
    await expect(page.locator('.launcher-result').filter({ hasText: 'OpenCode ·' })).toHaveCount(0)
    await expect(page.locator('.launcher-result').first()).toContainText('Files · Folder · Browse files')
    await input.press('Enter')
    await expect(page.locator('[data-kind="folder"]:visible .file-entry').first()).toBeVisible()
    expect(fixture.requests.filter(r => r.method === 'POST')).toEqual([])
    input = await search(page, 'files chatos'); await input.press('Enter')
    await expect(page.locator('[data-kind="folder"]')).toHaveCount(1)
    input = await search(page, 'start session in no-such-project')
    await expect(page.locator('.launcher-result')).toHaveCount(0)
    await input.fill('start session in chatos')
    await expect(page.locator('.launcher-result').first()).toContainText('OpenCode · Create session')
    await input.press('Enter')
    await expect(page.locator('[data-kind="session"]:visible textarea')).toBeVisible()
    expect(fixture.requests.filter(r => r.method === 'POST' && r.path.endsWith('/api/session'))).toHaveLength(1)
    await page.screenshot({ path: 'test-results/source-aware-desktop.png' })
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})

test('Files tiles browse and safely read private text resources with canonical identity and restart', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-file-ui-'), root = await mkdtemp('/tmp/opencode/chatos-private-files-')
  await mkdir(`${root}/nested`)
  await writeFile(`${root}/notes.html`, '<script>window.executed=true</script> PRIVATE-PREVIEW <img src="https://tracking.test/pixel">')
  await symlink(`${root}/notes.html`, `${root}/alias`)
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  let app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await expect(page.locator('.project-row').first()).toBeVisible()
    let input = await search(page, `files ${root}`); await input.press('Enter')
    const folder = page.locator(`[data-resource-key="folder:${root}"]`)
    await expect(folder.locator('.file-entry')).toHaveCount(3)
    await folder.getByRole('textbox', { name: 'Filter folder entries' }).fill('notes')
    await folder.locator('.files-entries').focus(); await page.keyboard.press('Enter')
    const file = page.locator(`[data-resource-key="file:${root}/notes.html"]`)
    await expect(file.locator('.file-preview')).toContainText('PRIVATE-PREVIEW')
    await expect(file.locator('.file-preview img, .file-preview script')).toHaveCount(0)
    const id = await file.getAttribute('data-tile-id')
    input = await search(page, `files ${root}/alias`); await input.press('Enter')
    await expect(page.locator('[data-kind="file"]')).toHaveCount(1)
    expect(await file.getAttribute('data-tile-id')).toBe(id)
    const saved = await page.evaluate(() => window.chatos.loadDesktop() || '')
    expect(saved).not.toContain('PRIVATE-PREVIEW')
    expect(fixture.requests.filter(r => r.method === 'POST')).toEqual([])
    input = await search(page, `files ${root}/missing`); await input.press('Enter')
    await expect(page.locator('[role="alert"]')).toBeVisible()
    await expect(input).toBeVisible()
    await page.getByRole('button', { name: 'Close launcher', exact: true }).click()
    await app.close(); app = await launchDesktop(env); page = await app.firstWindow()
    await expect(page.locator(`[data-tile-id="${id}"] .file-preview`)).toContainText('PRIVATE-PREVIEW')
    await expect(page.locator('[data-kind="folder"]')).toHaveCount(1)
    expect(fixture.requests.filter(r => r.method === 'POST')).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
})
