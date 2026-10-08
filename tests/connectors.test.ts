import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { Connectors, checkDestination, privateAddress } from '../src/main/connectors'
import { connectorFetch } from '../src/main/connector-network'
import { Storage } from '../src/main/storage'
import { exampleConnector, resourceKey, validateConnector, valueAt, type ConnectorDefinition } from '../src/shared/connectors'
import { desktopInitial, openTile, recipeTile, restoreDesktop, serializeDesktop } from '../src/shared/tiles'

const stores: Storage[] = []
const noSecrets = { available: () => false, encrypt: () => { throw new Error('No encryption') }, decrypt: () => { throw new Error('No decryption') } }
const codec = { available: () => true, encrypt: (s: string) => Buffer.from(s.split('').reverse().join('')), decrypt: (b: Buffer) => b.toString().split('').reverse().join('') }
function setup(options: { secure?: boolean; approved?: boolean; response?: unknown; status?: number; generated?: string } = {}) {
  const store = new Storage(mkdtempSync('/tmp/opencode/chatos-connectors-')); stores.push(store)
  const seen: { url: string; init?: RequestInit }[] = []
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify(options.response || { data: [{ id: '42', subject: 'Private subject', status: 'open' }], next: 'cursor-2' }), { status: options.status || 200 }) })
  const confirm = vi.fn(async (_title: string, _detail: string) => options.approved !== false), generate = vi.fn(async (_prompt: string) => options.generated || JSON.stringify(exampleConnector))
  const runtime = new Connectors(store, options.secure ? codec : noSecrets, confirm, generate, fetcher, async () => {})
  return { store, runtime, fetcher, confirm, generate, seen }
}
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.directory, { recursive: true, force: true }) } })
const publicDefinition = (): ConnectorDefinition => ({ ...structuredClone(exampleConnector), auth: { type: 'none' } })

describe('declarative connector schema', () => {
  it('accepts fixed renderers, typed messages and dotted data mappings', () => {
    const definition = publicDefinition(); definition.recipes[0].view = 'table'
    expect(validateConnector(definition).recipes[0].view).toBe('table')
    definition.recipes[0].view = 'timeline'; expect(validateConnector(definition).recipes[0].view).toBe('timeline')
    expect(valueAt({ nested: { title: 'Safe' } }, 'nested.title')).toBe('Safe')
    expect(valueAt({}, 'constructor')).toBeUndefined()
  })
  it('rejects executable recipes, arbitrary credential headers and unsafe paths', () => {
    for (const change of [
      (d: any) => { d.script = 'alert(1)' },
      (d: any) => { d.operations[0].headers = { Authorization: 'secret' } },
      (d: any) => { d.operations[0].path = '//evil.test/' },
      (d: any) => { d.operations[0].path = '/%2e%2e/secret' },
      (d: any) => { d.operations[0].path = '/tickets/{draft}' },
      (d: any) => { d.operations[0].query = { api_key: 'secret' } },
      (d: any) => { d.recipes[0].titleField = 'constructor.prototype' },
      (d: any) => { d.recipes[0].itemRecipe = 'missing' },
      (d: any) => { d.operations[0].method = 'POST' },
    ]) { const d = publicDefinition(); change(d); expect(() => validateConnector(d)).toThrow() }
  })
  it('separates collection identity from item identity and deduplicates alternate presentations', () => {
    const ref = { connectorID: 'helpdesk', recipeID: 'ticket', resourceID: '42' }, detail = exampleConnector.recipes[1]
    let state = openTile(desktopInitial(), recipeTile(ref, 'Subject', detail))
    state = openTile(state, recipeTile(ref, 'Found elsewhere', detail), 'new')
    expect(state.tiles).toHaveLength(1); expect(state.workspaces).toHaveLength(1)
    const one = resourceKey({ ...ref, recipeID: 'document' }, { identity: 'ticket', shape: 'item' })
    expect(one).toBe(resourceKey(ref))
    expect(resourceKey({ connectorID: 'helpdesk', recipeID: 'inbox', query: 'mine' })).not.toBe(resourceKey({ connectorID: 'helpdesk', recipeID: 'inbox', query: 'all' }))
    expect(restoreDesktop(serializeDesktop(state)).tiles[0].key).toBe(state.tiles[0].key)
  })
  it('keeps channel-scoped thread identities distinct and durable', () => {
    const recipe = { shape: 'item' as const, identityScope: 'parent' as const }
    const first = { connectorID: 'chat', recipeID: 'thread', parentID: 'channel-a', resourceID: '123.456' }
    const second = { ...first, parentID: 'channel-b' }
    expect(resourceKey(first, recipe)).not.toBe(resourceKey(second, recipe))
    expect(() => resourceKey({ ...first, parentID: undefined }, recipe)).toThrow('parent')
    let state = openTile(desktopInitial(), recipeTile(first, 'Thread A', recipe))
    state = openTile(state, recipeTile(second, 'Thread B', recipe))
    expect(restoreDesktop(serializeDesktop(state)).tiles.map(t => t.key)).toEqual(state.tiles.map(t => t.key))
  })
})

describe('restricted connector runtime', () => {
  it('does not activate a proposal or access any API before approval', async () => {
    const { runtime, store, fetcher, generate } = setup({ approved: false })
    const proposal = await runtime.propose({ description: 'Helpdesk', baseURL: exampleConnector.baseURL, documentation: 'GET /tickets and GET /tickets/{id}' })
    expect(proposal).toEqual(validateConnector(exampleConnector)); expect(store.definitions()).toEqual([]); expect(fetcher).not.toHaveBeenCalled()
    await expect(runtime.save(proposal, 0)).rejects.toThrow('cancelled')
    expect(generate).toHaveBeenCalledOnce(); expect(store.definitions()).toEqual([])
  })
  it('reads/searches/paginates one API with native mapping and another unrelated record API', async () => {
    const first = setup(); await first.runtime.save(publicDefinition(), 0)
    const page = await first.runtime.read({ connectorID: 'helpdesk', recipeID: 'inbox', query: 'assigned' }, 'cursor-1')
    expect(page.items[0].title).toBe('Private subject'); expect(page.next).toBe('cursor-2')
    expect(first.seen[0].url).toBe('https://api.example.com/tickets?search=assigned&cursor=cursor-1')
    const found = await first.runtime.search('Private')
    expect(found.resources[0].ref).toEqual({ connectorID: 'helpdesk', recipeID: 'ticket', resourceID: '42' })
    const second = setup({ response: { rows: [{ uuid: 'asset-7', name: 'Machine', count: 4 }] } })
    const inventory: ConnectorDefinition = { version: 1, id: 'inventory', name: 'Inventory', baseURL: 'https://inventory.example.test/v2', auth: { type: 'none' }, operations: [{ id: 'assets', label: 'List', method: 'GET', effect: 'read', path: '/assets' }, { id: 'asset', label: 'Get', method: 'GET', effect: 'read', path: '/assets/{id}' }], recipes: [{ id: 'assets', label: 'Assets', shape: 'collection', view: 'table', operation: 'assets', items: 'rows', idField: 'uuid', titleField: 'name', itemRecipe: 'asset', fields: [{ label: 'Count', path: 'count', kind: 'number' }] }, { id: 'asset', label: 'Asset', shape: 'item', view: 'record', operation: 'asset', idField: 'uuid', titleField: 'name' }] }
    await second.runtime.save(inventory, 0)
    expect((await second.runtime.read({ connectorID: 'inventory', recipeID: 'assets' })).items[0].fields).toEqual([{ label: 'Count', value: '4', kind: 'number' }])
    expect(second.seen[0].url).toBe('https://inventory.example.test/v2/assets')
  })
  it('preserves internal notes, tool calls and events; HTML never executes or loads images', async () => {
    const { runtime } = setup({ response: { id: '42', subject: 'Thread', messages: [{ type: 'comment', body: '<p>Internal note</p><script>steal()</script><img src="https://track.test">', author: 'Alice' }, { type: 'tool', body: 'Used a tool' }, { type: 'activity', body: 'Archived' }, { type: 'toString', body: 'Unknown kind' }] } })
    await runtime.save(publicDefinition(), 0)
    const page = await runtime.read({ connectorID: 'helpdesk', recipeID: 'ticket', resourceID: '42' })
    expect(page.messages.map(m => m.kind)).toEqual(['note', 'tool-call', 'event', 'message'])
    expect(page.messages[0].text).toBe('Internal note'); expect(page.messages[0].author).toBe('Alice')
  })
  it('keeps credentials out of prompts/recipes/status and clears them when destination changes', async () => {
    const { store, runtime, generate, seen } = setup({ secure: true })
    await runtime.save(exampleConnector, 0); await runtime.setToken('helpdesk', 'never-in-a-prompt-secret')
    await runtime.read({ connectorID: 'helpdesk', recipeID: 'inbox' })
    expect(new Headers(seen[0].init?.headers).get('authorization')).toBe('Bearer never-in-a-prompt-secret')
    expect(JSON.stringify(runtime.list())).not.toContain('never-in-a-prompt-secret')
    await runtime.propose({ description: 'Helpdesk', baseURL: exampleConnector.baseURL, documentation: 'Public docs' })
    expect(generate.mock.calls[0][0]).not.toContain('never-in-a-prompt-secret')
    expect(readFileSync(store.backup()).includes(Buffer.from('never-in-a-prompt-secret'))).toBe(false)
    await runtime.save({ ...exampleConnector, baseURL: 'https://new.example.test' }, 1)
    expect(runtime.list()[0].hasToken).toBe(false); expect(store.secret('connector:helpdesk')).toBeUndefined()
  })
  it('keeps tokens in memory when OS storage is unavailable', async () => {
    const { store, runtime } = setup()
    await runtime.save(exampleConnector, 0); await runtime.setToken('helpdesk', 'memory-only')
    expect(runtime.list()[0].tokenStorage).toBe('session'); expect(store.secret('connector:helpdesk')).toBeUndefined()
    const restarted = new Connectors(store, noSecrets, async () => true, async () => '')
    expect(restarted.list()[0].hasToken).toBe(false)
  })
  it('refuses Gmail OAuth-only flows rather than accepting an app password', async () => {
    const { runtime, fetcher } = setup()
    await runtime.save({ ...exampleConnector, id: 'gmail', name: 'Gmail', baseURL: 'https://gmail.googleapis.com/gmail/v1', auth: { type: 'oauth-required', help: 'Registered Google OAuth client required.' } }, 0)
    await expect(runtime.setToken('gmail', 'app-password')).rejects.toThrow('OAuth')
    await expect(runtime.read({ connectorID: 'gmail', recipeID: 'inbox' })).rejects.toThrow('OAuth')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('writes only actions registered on the tile and previews exact parameters in a native confirmation', async () => {
    const { runtime, seen, confirm } = setup()
    const d = publicDefinition()
    d.operations.push({ id: 'reply', label: 'Send reply', method: 'POST', effect: 'write', path: '/tickets/{id}/reply', body: { text: '{draft}' } })
    d.recipes[1].actions = [{ label: 'Reply', operation: 'reply' }]
    await runtime.save(d, 0)
    confirm.mockResolvedValueOnce(false)
    await expect(runtime.action({ connectorID: 'helpdesk', recipeID: 'ticket', resourceID: '42' }, 'reply', 'Never sent')).rejects.toThrow('cancelled')
    expect(seen).toEqual([])
    await expect(runtime.action({ connectorID: 'helpdesk', recipeID: 'inbox' }, 'reply', 'Wrong tile')).rejects.toThrow('not approved')
    await runtime.action({ connectorID: 'helpdesk', recipeID: 'ticket', resourceID: '42' }, 'reply', 'Confirmed test reply')
    expect(seen).toHaveLength(1); expect(seen[0].init?.method).toBe('POST'); expect(seen[0].init?.body).toBe('{"text":"Confirmed test reply"}')
    expect(confirm.mock.calls.at(-1)?.[1]).toContain('Exact JSON body: {"text":"Confirmed test reply"}')
  })
  it('rejects unapproved AI search IDs and returns multiple candidates instead of choosing a resource', async () => {
    const { runtime, generate } = setup({ response: { data: [{ id: '1', subject: 'Same' }, { id: '2', subject: 'Same' }] } })
    await runtime.save(publicDefinition(), 0)
    generate.mockResolvedValueOnce('{"searches":[{"connectorID":"helpdesk","recipeID":"inbox","query":"same"}]}')
    expect((await runtime.planSearch('Find same ticket')).resources).toHaveLength(2)
    generate.mockResolvedValueOnce('{"searches":[{"connectorID":"evil","recipeID":"inbox","query":"same"}]}')
    await expect(runtime.planSearch('Find same ticket')).rejects.toThrow('unapproved')
  })
  it('bounds response bytes, backs off on rate limits and does not follow pagination URLs', async () => {
    const large = setup({ response: { data: 'x'.repeat(1_000_001) } }); await large.runtime.save(publicDefinition(), 0)
    await expect(large.runtime.read({ connectorID: 'helpdesk', recipeID: 'inbox' })).rejects.toThrow('1 MB')
    const rate = setup({ status: 429 }); await rate.runtime.save(publicDefinition(), 0)
    await expect(rate.runtime.read({ connectorID: 'helpdesk', recipeID: 'inbox' })).rejects.toThrow('429')
    await expect(rate.runtime.read({ connectorID: 'helpdesk', recipeID: 'inbox' })).rejects.toThrow('rate-limited')
    expect(rate.seen).toHaveLength(1)
    const safe = setup(); await safe.runtime.save(publicDefinition(), 0)
    await safe.runtime.read({ connectorID: 'helpdesk', recipeID: 'inbox' }, 'https://evil.test/steal')
    expect(safe.seen[0].url).toContain('https://api.example.com/tickets?cursor=https%3A')
    await expect(safe.runtime.read({ connectorID: 'helpdesk', recipeID: 'ticket', resourceID: '../secret' })).rejects.toThrow('separators')
  })
  it('accepts declared same-operation pagination links and blocks credential forwarding to other endpoints', async () => {
    const { runtime, seen } = setup(), d = publicDefinition()
    d.operations[0].pagination = 'next-url'; d.operations[0].query = { page: '1', limit: '25' }
    await runtime.save(d, 0)
    await runtime.read({ connectorID: 'helpdesk', recipeID: 'inbox' }, 'https://api.example.com/tickets?page=2&limit=25')
    expect(seen[0].url).toBe('https://api.example.com/tickets?page=2&limit=25')
    for (const next of ['https://evil.test/tickets?page=2', 'https://api.example.com/admin?page=2', 'https://api.example.com/tickets?api_key=secret']) await expect(runtime.read({ connectorID: 'helpdesk', recipeID: 'inbox' }, next)).rejects.toThrow('Pagination')
    expect(seen).toHaveLength(1)
  })
  it('maps thread parents from global search and rejects missing parent-scoped identities', async () => {
    const { runtime } = setup({ response: { data: [{ id: '42', subject: 'Thread', channel: { id: 'channel-a' } }] } }), d = publicDefinition()
    d.recipes[0].parentField = 'channel.id'; d.recipes[1].identityScope = 'parent'; d.operations[1].path = '/channels/{parent}/threads/{id}'
    await runtime.save(d, 0)
    expect((await runtime.search('Thread')).resources[0].ref.parentID).toBe('channel-a')
    await expect(runtime.read({ connectorID: 'helpdesk', recipeID: 'ticket', resourceID: '42' })).rejects.toThrow('parent')
  })
  it('suppresses duplicate pending actions in the main process, not only the renderer', async () => {
    const { runtime, confirm, seen } = setup(), d = publicDefinition()
    d.operations.push({ id: 'archive', label: 'Archive', method: 'POST', effect: 'write', path: '/tickets/{id}/archive' })
    d.recipes[1].actions = [{ label: 'Archive', operation: 'archive' }]
    await runtime.save(d, 0)
    let approve!: (yes: boolean) => void
    confirm.mockImplementationOnce(() => new Promise<boolean>(resolve => { approve = resolve }))
    const ref = { connectorID: 'helpdesk', recipeID: 'ticket', resourceID: '42' }
    const first = runtime.action(ref, 'archive', '')
    await expect(runtime.action(ref, 'archive', '')).rejects.toThrow('already pending')
    approve(true); await first; expect(seen).toHaveLength(1)
  })
})

describe('connector network boundary', () => {
  it('blocks private, link-local and mapped addresses except explicitly configured loopback', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.0.1', '169.254.169.254', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) expect(privateAddress(ip)).toBe(true)
    expect(privateAddress('8.8.8.8')).toBe(false); expect(privateAddress('2606:4700::1111')).toBe(false)
    await expect(checkDestination('https://169.254.169.254')).rejects.toThrow('public')
    await expect(checkDestination('http://127.0.0.1:1234')).resolves.toBeUndefined()
    await expect(connectorFetch('https://10.0.0.1')).rejects.toThrow('blocked')
  })
  it('can read an explicitly approved loopback API without following redirects', async () => {
    let requests = 0
    const server = createServer((req, res) => { requests++; if (req.url === '/redirect') { res.writeHead(302, { location: '/stolen' }); res.end() } else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}') } })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try { expect(await (await connectorFetch(`${base}/read`)).json()).toEqual({ ok: true }); expect((await connectorFetch(`${base}/redirect`)).status).toBe(302); expect(requests).toBe(2) }
    finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
