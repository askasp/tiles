import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { exampleConnector, type ConnectorDefinition } from '../../src/shared/connectors'
import { launchDesktop } from './launch'
import { fixtureServer } from './fixture'

async function customAPI() {
  const requests: { method: string; path: string; authorization?: string; body: string }[] = []
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const url = new URL(req.url || '/', 'http://localhost')
    requests.push({ method: req.method!, path: url.pathname, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() })
    const json = (data: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (url.pathname === '/tickets') return json({ data: [{ id: '42', subject: 'Private customer thread', status: 'open' }, { id: '43', subject: 'Private customer thread', status: 'pending' }] })
    if (url.pathname === '/tickets/42') return json({ id: '42', subject: 'Private customer thread', status: 'open', messages: [{ type: 'reply', author: 'Customer', body: 'Private customer message' }, { type: 'comment', author: 'Colleague', body: '<p>Internal note</p><img src="https://tracking.invalid/pixel"><script>window.stolen=true</script>' }, { type: 'tool', body: 'Read 3 files' }, { type: 'activity', body: 'Assigned to you' }] })
    if (url.pathname === '/tickets/42/reply') { res.writeHead(204); res.end(); return }
    if (url.pathname === '/oauth/token') return json({ access_token: 'fake-oauth-private-access', refresh_token: 'fake-oauth-private-refresh', expires_in: 3600, token_type: 'Bearer' })
    if (url.pathname === '/assets') return json([{ uuid: 'a-1', name: 'Pump', count: 10, date: '2026-10-08' }, { uuid: 'a-2', name: 'Valve', count: 2, date: '2026-10-07' }])
    if (url.pathname === '/assets/a-1') return json({ uuid: 'a-1', name: 'Pump', count: 10 })
    res.writeHead(404); res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, requests, async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
async function launcher(page: Page, query: string) { await page.getByRole('button', { name: 'Launcher', exact: true }).click(); await page.getByRole('textbox', { name: 'Launcher search' }).fill(query) }
const environment = (profile: string, url: string) => { const env = { ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string')), CHATOS_USER_DATA: profile, CHATOS_SERVER_URL: url }; delete (env as Record<string, string>).ELECTRON_RUN_AS_NODE; return env }

test('AI proposes an inspectable adapter; reads and writes obey unique identity, approval and durable drafts', async () => {
  const api = await customAPI(), profile = await mkdtemp('/tmp/opencode/chatos-generic-ui-')
  const definition = structuredClone(exampleConnector); definition.baseURL = api.url
  definition.operations.push({ id: 'reply', label: 'Send reply', method: 'POST', effect: 'write', path: '/tickets/{id}/reply', body: { text: '{draft}' } })
  definition.recipes[1].actions = [{ label: 'Reply', operation: 'reply' }]
  const fixture = await fixtureServer({ generate: prompt => prompt.startsWith('Translate') ? '{"searches":[{"connectorID":"helpdesk","recipeID":"inbox","query":"customer"}]}' : JSON.stringify(definition) })
  const env = environment(profile, fixture.url)
  let app = await launchDesktop(env), page = await app.firstWindow()
  try {
    await expect(page.locator('.project-row').first()).toBeVisible()
    await app.evaluate(({ dialog, safeStorage }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox; safeStorage.isEncryptionAvailable = () => false })
    await page.getByRole('button', { name: 'Add / manage source', exact: true }).click()
    await page.getByRole('textbox', { name: 'Connector description' }).fill('Helpdesk inbox and tickets')
    await page.getByRole('textbox', { name: 'Connector API URL' }).fill(api.url)
    await page.getByRole('textbox', { name: 'Connector API documentation' }).fill('GET /tickets: {data:[{id,subject,status}]}. GET /tickets/{id}: {id,subject,messages:[{body,type,author}]}. POST /tickets/{id}/reply: {text}. Bearer token.')
    await page.getByRole('button', { name: 'Generate mapping proposal' }).click()
    await expect(page.getByRole('status')).toContainText('Proposal only')
    expect(api.requests).toEqual([])
    await expect(page.locator('.connector-mapping')).toContainText('Separate ticket tile')
    await page.getByRole('button', { name: 'Keep mapping', exact: false }).click()
    await expect(page.getByRole('heading', { name: 'Helpdesk · authenticate & open' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Connector token' }).fill('fake-generic-private-token')
    await page.getByRole('button', { name: 'Connect token', exact: false }).click()
    await expect(page.getByRole('textbox', { name: 'Connector token' })).toHaveValue('')
    await page.getByRole('button', { name: 'Open Ticket inbox', exact: true }).click()
    const list = page.locator('[data-kind="recipe"]:visible').filter({ has: page.locator('.recipe-list-row') })
    await expect(list.locator('.recipe-list-row')).toHaveCount(2)
    await list.locator('.recipe-list-row').first().click()
    let detail = page.locator('[data-resource-key="connector:helpdesk:ticket:item:42"]')
    await expect(detail).toBeVisible(); await expect(list).toBeVisible()
    await expect(detail.locator('.recipe-message-note')).toContainText('Internal note')
    await expect(detail.locator('.recipe-message-tool-call')).toContainText('Read 3 files')
    await expect(detail.locator('img, script')).toHaveCount(0)
    await detail.getByRole('textbox', { name: 'Resource action draft' }).fill('Unsaved customer reply must survive')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox })
    await detail.getByRole('button', { name: 'Reply · confirm…' }).click()
    await expect(detail.getByRole('alert')).toContainText('cancelled')
    await expect(detail.getByRole('textbox', { name: 'Resource action draft' })).toHaveValue('Unsaved customer reply must survive')
    expect(api.requests.filter(r => r.method !== 'GET')).toHaveLength(0)
    await launcher(page, 'find the customer ticket')
    await page.getByRole('button', { name: 'Ask AI to find…' }).click()
    const found = page.locator('.launcher-result').filter({ has: page.locator('strong', { hasText: /^Private customer thread$/ }) })
    await expect(found).toHaveCount(2) // Ambiguity is shown, not silently resolved.
    await found.first().click()
    await expect(page.locator('[data-resource-key="connector:helpdesk:ticket:item:42"]')).toHaveCount(1)
    expect(fixture.requests.filter(r => r.path === '/api/session' && r.method === 'POST')).toEqual([])
    expect(fixture.requests.filter(r => r.path.endsWith('/prompt'))).toEqual([])
    await page.screenshot({ path: 'test-results/generated-connector-desktop.png' })
    await app.close(); app = await launchDesktop(env); page = await app.firstWindow()
    detail = page.locator('[data-resource-key="connector:helpdesk:ticket:item:42"]')
    await expect(detail.getByRole('textbox', { name: 'Resource action draft' })).toHaveValue('Unsaved customer reply must survive')
    await expect(detail.getByRole('alert')).toContainText('Connect an API token')
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox })
    await detail.getByRole('button', { name: 'Mapping', exact: true }).click()
    await page.getByRole('button', { name: 'Helpdesk · v1', exact: true }).click()
    await page.getByRole('textbox', { name: 'Connector token' }).fill('fake-generic-private-token')
    await page.getByRole('button', { name: 'Connect token', exact: false }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(detail.locator('.recipe-message-note')).toContainText('Internal note')
    await detail.getByRole('button', { name: 'Reply · confirm…' }).click()
    await expect(detail.getByRole('textbox', { name: 'Resource action draft' })).toHaveValue('')
    expect(api.requests.filter(r => r.method === 'POST')).toEqual([{ method: 'POST', path: '/tickets/42/reply', authorization: 'Bearer fake-generic-private-token', body: '{"text":"Unsaved customer reply must survive"}' }])
    const saved = await page.evaluate(() => window.chatos.loadDesktop()!)
    expect(saved).not.toContain('Private customer message'); expect(saved).not.toContain('fake-generic-private-token')
    expect(await page.evaluate(() => localStorage.getItem('chatos.desktop.v2'))).toBeNull()
    expect((await stat(`${profile}/chatos.sqlite`)).mode & 0o777).toBe(0o600)
    expect((await readFile(`${profile}/chatos.sqlite`)).includes(Buffer.from('fake-generic-private-token'))).toBe(false)
  } finally { await app.close(); await fixture.close(); await api.close(); await rm(profile, { recursive: true, force: true }) }
})

test('unrelated inventory API uses fixed Table and Timeline renderers and retains record ownership', async () => {
  const api = await customAPI(), fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-inventory-ui-')
  const app = await launchDesktop(environment(profile, fixture.url)), page = await app.firstWindow()
  const definition: ConnectorDefinition = { version: 1, id: 'inventory', name: 'Inventory', baseURL: api.url, auth: { type: 'none' }, operations: [{ id: 'assets', label: 'Read assets', method: 'GET', effect: 'read', path: '/assets' }, { id: 'asset', label: 'Read asset', method: 'GET', effect: 'read', path: '/assets/{id}' }], recipes: [{ id: 'assets', label: 'Assets', shape: 'collection', view: 'table', operation: 'assets', items: '', idField: 'uuid', titleField: 'name', itemRecipe: 'asset', fields: [{ label: 'Count', path: 'count', kind: 'number' }] }, { id: 'timeline', label: 'Asset timeline', shape: 'collection', view: 'timeline', operation: 'assets', items: '', idField: 'uuid', titleField: 'name', timeField: 'date', itemRecipe: 'asset' }, { id: 'asset', label: 'Asset', shape: 'item', view: 'record', operation: 'asset', idField: 'uuid', titleField: 'name', fields: [{ label: 'Count', path: 'count', kind: 'number' }] }] }
  try {
    await expect(page.locator('.project-row').first()).toBeVisible()
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox })
    await page.getByRole('button', { name: 'Add / manage source', exact: true }).click()
    await page.getByRole('textbox', { name: 'Connector recipe JSON' }).fill(JSON.stringify(definition))
    await page.getByRole('button', { name: 'Keep mapping', exact: false }).click()
    await page.getByRole('button', { name: 'Open Assets', exact: true }).click()
    await expect(page.locator('.recipe-table tbody tr')).toHaveCount(2)
    await page.getByRole('button', { name: 'Count ↕' }).click()
    await expect(page.locator('.recipe-table tbody tr').first()).toContainText('Valve')
    await page.getByRole('button', { name: 'Pump', exact: true }).click()
    const record = page.locator('[data-resource-key="connector:inventory:asset:item:a-1"]')
    await expect(record.locator('.recipe-fields')).toContainText('10')
    await launcher(page, 'Asset timeline')
    await page.locator('.launcher-result').filter({ has: page.locator('strong', { hasText: /^Asset timeline$/ }) }).click()
    await expect(page.locator('.recipe-timeline-row').first()).toContainText('Valve')
    await page.locator('.recipe-timeline-row').filter({ hasText: 'Pump' }).click()
    await expect(record).toHaveCount(1)
    expect(api.requests.every(r => r.method === 'GET')).toBe(true)
  } finally { await app.close(); await fixture.close(); await api.close(); await rm(profile, { recursive: true, force: true }) }
})

test('OpenCode project collection, session collection and session are peer tiles', async () => {
  const fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-project-hierarchy-')
  const app = await launchDesktop(environment(profile, fixture.url)), page = await app.firstWindow()
  try {
    await expect(page.locator('.project-row').first()).toBeVisible()
    await page.getByRole('button', { name: 'Projects tile', exact: true }).click()
    await page.locator('[data-kind="projects"] .recipe-list-row').filter({ has: page.locator('strong', { hasText: /^chatos$/ }) }).click()
    await page.locator('[data-kind="project"] .session-row').filter({ hasText: 'Consent reload' }).click()
    await expect(page.locator('[data-kind="projects"]:visible')).toHaveCount(1)
    await expect(page.locator('[data-kind="project"]:visible')).toHaveCount(1)
    await expect(page.locator('[data-kind="session"]:visible')).toHaveCount(1)
    expect(fixture.requests.filter(r => r.method !== 'GET')).toEqual([])
  } finally { await app.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }) }
})

test('registered OAuth connector signs in via PKCE and uses only broker-held credentials', async () => {
  const api = await customAPI(), fixture = await fixtureServer(), profile = await mkdtemp('/tmp/opencode/chatos-oauth-ui-')
  const app = await launchDesktop(environment(profile, fixture.url)), page = await app.firstWindow()
  const definition = structuredClone(exampleConnector)
  definition.id = 'helpdesk-oauth'; definition.baseURL = api.url
  definition.auth = { type: 'oauth2', oauth: { clientID: 'fake-native-client', authorizationURL: `${api.url}/oauth/authorize`, tokenURL: `${api.url}/oauth/token`, scopes: ['tickets:read'] } }
  try {
    await expect(page.locator('.project-row').first()).toBeVisible()
    await app.evaluate(({ dialog, shell }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
      shell.openExternal = async raw => { const auth = new URL(raw), callback = new URL(auth.searchParams.get('redirect_uri')!); callback.searchParams.set('state', auth.searchParams.get('state')!); callback.searchParams.set('code', 'private-fixture-code'); await fetch(callback) }
    })
    await page.getByRole('button', { name: 'Add / manage source', exact: true }).click()
    await page.getByRole('textbox', { name: 'Connector recipe JSON' }).fill(JSON.stringify(definition))
    await page.getByRole('button', { name: 'Keep mapping', exact: false }).click()
    await page.getByRole('button', { name: 'Sign in with OAuth', exact: false }).click()
    await expect(page.getByRole('status')).toContainText('OAuth connected')
    await page.getByRole('button', { name: 'Open Ticket inbox', exact: true }).click()
    await expect(page.locator('.recipe-list-row')).toHaveCount(2)
    const exchange = api.requests.find(r => r.path === '/oauth/token')!
    expect(new URLSearchParams(exchange.body).get('code_verifier')).toHaveLength(43)
    expect(api.requests.find(r => r.path === '/tickets')?.authorization).toBe('Bearer fake-oauth-private-access')
    expect(await page.evaluate(() => JSON.stringify(window.chatos.loadDesktop()))).not.toContain('fake-oauth-private-access')
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('fake-oauth-private-refresh')
  } finally { await app.close(); await fixture.close(); await api.close(); await rm(profile, { recursive: true, force: true }) }
})
