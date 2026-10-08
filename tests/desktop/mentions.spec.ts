import { test, expect } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { desktopReady, launchDesktop, startSession } from './launch'
import { fixtureServer } from './fixture'

test('in a new session, @ completes files and folders and / completes commands and skills, by keyboard', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-mentions-')
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: fixture.url }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await desktopReady(page, { opencode: true })
    await startSession(page, 'chatos')
    const tile = page.locator('[data-kind="session"].tile-focused')
    const input = tile.locator('textarea')
    await input.focus()
    const menu = tile.locator('.mention-menu')

    // “@” lists files and folders; Enter on a file inserts it with a space.
    await page.keyboard.type('fix @compo')
    await expect(menu.locator('.mention-option')).toHaveText([/src\/renderer\/sources\/opencode\/Composer\.tsx/])
    await page.keyboard.press('Enter')
    await expect(input).toHaveValue('fix @src/renderer/sources/opencode/Composer.tsx ')
    await expect(menu).toHaveCount(0)

    // A folder keeps completing inside it; Esc closes the list without leaving the message box.
    await page.keyboard.type('and @sr')
    await expect(menu.locator('.mention-option.selected')).toHaveText('foldersrc/')
    await page.keyboard.press('Tab')
    await expect(input).toHaveValue('fix @src/renderer/sources/opencode/Composer.tsx and @src/')
    await expect(menu.locator('.mention-option')).toContainText(['src/renderer/sources/opencode/Composer.tsx'])
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(input).toBeFocused()

    // Sending attaches the mentioned file and folder that exist, with where they were mentioned.
    await page.keyboard.press('Enter')
    await expect.poll(() => fixture.requests.filter(r => r.path.endsWith('/prompt')).length).toBe(1)
    const prompt = fixture.requests.find(r => r.path.endsWith('/prompt'))!.body as { text: string; files: { uri: string; name: string; mention: { start: number; end: number } }[] }
    expect(prompt.files.map(f => f.name)).toEqual(['src/renderer/sources/opencode/Composer.tsx', 'src/'])
    expect(prompt.files[0].uri).toMatch(/^file:\/\/.*\/src\/renderer\/sources\/opencode\/Composer\.tsx$/)
    expect(prompt.text.slice(prompt.files[0].mention.start, prompt.files[0].mention.end)).toBe('@src/renderer/sources/opencode/Composer.tsx')

    await expect(input).toHaveValue('')
    // “/” lists commands and skills; a skill attaches to the prompt.
    await page.keyboard.type('/')
    await expect(menu.locator('.mention-option')).toHaveText([/command\/review/, /skill\/opencode/, /skill\/release-notes/])
    await page.keyboard.type('rel')
    await page.keyboard.press('Enter')
    await expect(input).toHaveValue('/release-notes ')
    await page.keyboard.type('for 2.1')
    await page.keyboard.press('Enter')
    await expect.poll(() => fixture.requests.filter(r => r.path.endsWith('/prompt')).length).toBe(2)
    const skilled = fixture.requests.filter(r => r.path.endsWith('/prompt'))[1].body as { skills: { id: string }[] }
    expect(skilled.skills.map(s => s.id)).toEqual(['release-notes'])

    await expect(input).toHaveValue('')
    // A leading command runs as that command, with the rest as its arguments.
    await page.keyboard.type('/rev')
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await page.keyboard.type('the auth module')
    await page.keyboard.press('Enter')
    await expect.poll(() => fixture.requests.filter(r => /^\/api\/session\/.*\/command$/.test(r.path)).length).toBe(1)
    expect(fixture.requests.find(r => /^\/api\/session\/.*\/command$/.test(r.path))!.body).toMatchObject({ name: 'review', text: 'the auth module' })
  } finally {
    await app.close(); await fixture.close()
  }
})
