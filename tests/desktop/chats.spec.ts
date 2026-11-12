import { test, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { ask, launchDesktop } from './launch'
import { fixtureServer } from './fixture'

const environment = (profile: string, url: string) => { const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: url }; delete env.ELECTRON_RUN_AS_NODE; return env }

test('G: a quick ask outgrows K, continues in a Chat tile, makes a document beside it, and both are listed and kept', async () => {
  const fixture = await fixtureServer({ generate: prompt => {
    const last = prompt.slice(prompt.lastIndexOf('\n\n') + 2)
    if (/make it a document/i.test(last)) return 'Here are the release notes.\n<artifact title="chatos 0.4 release notes">\n## New\n- Connector schema v2. #149\n\n## Fixed\n- Front proxy support. #140\n</artifact>'
    if (/proxy/i.test(last)) { const id = prompt.match(/<artifact id="([^"]+)"/)?.[1]; return `<artifact id="${id}" title="chatos 0.4 release notes">\n## Fixed\n- Front works behind a proxy. #140\n</artifact>\nUpdated.` }
    if (/rate limit/i.test(last)) return '50 requests per minute per token.'
    return 'Grouped and shortened to 112 words.'
  } })
  const profile = await mkdtemp('/tmp/opencode/chatos-chats-')
  let app = await launchDesktop(environment(profile, fixture.url)), page = await app.firstWindow()
  try {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox })
    await page.getByRole('textbox', { name: 'Model base URL' }).fill(`${fixture.url}/v1`)
    await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue('fixture-chat')
    await page.getByRole('textbox', { name: 'Launcher search' }).press('Enter')
    await expect(page.locator('.k-reply')).toContainText('Ready.')

    // G1: a request in K is answered in K. ↵ replies there.
    const input = await ask(page, 'draft release notes for 0.4 from the PRs merged this week', false)
    await expect(page.locator('.launcher-result').first()).toContainText('Ask K')
    await input.press('Enter')
    await expect(page.locator('.k-thread-reply')).toContainText('Grouped and shortened')
    await input.fill('use plain language, link each PR')
    await input.press('Enter')
    await expect(page.locator('.k-thread-ask.latest')).toContainText('turn 2')
    await expect(page.locator('.k-thread-rows .k-row').first()).toContainText('Continue in a Chat tile')

    // G2: Ctrl+↵ moves the same thread into a Chat tile.
    await input.press('Control+Enter')
    const chat = page.locator('[data-kind="chat"]:visible')
    await expect(chat.locator('.k-turn')).toHaveCount(4)
    await expect(chat.locator('.tile-title')).toHaveText('draft release notes for 0.4 from the PRs merged this week')

    // G3: the document opens beside the chat; an edit is v2 of the same artifact.
    const reply = chat.getByRole('textbox', { name: 'Reply to K' })
    await reply.fill('yes, make it a document')
    await reply.press('Enter')
    const doc = page.locator('[data-kind="artifact"]:visible')
    await expect(doc.locator('.k-artifact-page')).toContainText('Connector schema v2')
    await expect(chat).toHaveClass(/tile-focused/)
    await expect(chat.locator('.k-artifact-card')).toContainText('Document · v1')
    await reply.fill('say “Front works behind a proxy” instead of the issue title')
    await reply.press('Enter')
    await expect(doc.locator('.k-artifact-page')).toContainText('Front works behind a proxy')
    await expect(doc.locator('.k-version.current')).toHaveText('v2')
    await expect(doc.locator('.k-new')).toBeVisible()
    await expect(page.locator('[data-kind="artifact"]')).toHaveCount(1)

    // A quick ask, closed with esc, is kept under Quick.
    const quick = await ask(page, 'what’s the rate limit on the Front API?', false)
    await quick.press('Enter')
    await expect(page.locator('.k-thread-reply')).toContainText('50 requests')
    await quick.press('Escape')

    // G4: chats as a list, quick asks in their own group, artifacts with each chat.
    await ask(page, 'chats', false)
    // Ctrl+click joins this page (a plain click gives the list its own space).
    await page.locator('.launcher-result').filter({ hasText: 'Browse chats' }).first().click({ modifiers: ['Control'] })
    const list = page.locator('[data-kind="chats"]:visible')
    await expect(list.locator('section[aria-label="Quick"]')).toContainText('rate limit')
    await expect(list.locator('section[aria-label="Today"]')).toContainText('1 artifact, v2')
    expect(fixture.requests.filter(r => r.path === '/v1/chat/completions')).toHaveLength(5)

    // Chats and documents survive a restart.
    await app.close()
    app = await launchDesktop(environment(profile, fixture.url)); page = await app.firstWindow()
    await expect(page.locator('[data-kind="artifact"]:visible .k-artifact-page')).toContainText('Front works behind a proxy')
    await expect(page.locator('[data-kind="chats"]:visible section[aria-label="Quick"]')).toContainText('rate limit')
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})
