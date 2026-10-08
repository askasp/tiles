import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { Connectors } from '../src/main/connectors'
import { codeConnectors } from '../src/main/code-connectors'
import { frontCursor, frontMessage } from '../src/main/front-data'
import { Storage } from '../src/main/storage'
import { frontFilters, frontIdentity } from '../src/shared/front'
import { validateConnector } from '../src/shared/connectors'
import { desktopInitial, restoreDesktop, serializeDesktop } from '../src/shared/tiles'

const stores: Storage[] = []
const codec = { available: () => true, encrypt: (s: string) => Buffer.from(s.split('').reverse().join('')), decrypt: (b: Buffer) => b.toString().split('').reverse().join('') }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>
/** A Connectors runtime with the built-in `id` added and a token connected. */
async function connected(id: string, route: Route, options: { approve?: boolean; store?: Storage } = {}) {
  const store = options.store || new Storage(mkdtempSync('/tmp/opencode/chatos-code-')); if (!options.store) stores.push(store)
  const calls: { url: URL; init?: RequestInit }[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => { const url = new URL(String(input)); calls.push({ url, init }); return route(url, init) })
  const confirm = vi.fn(async (_title: string, _detail: string) => options.approve !== false)
  const runtime = new Connectors(store, codec, confirm, async () => '{}', fetcher as typeof fetch, async () => {})
  await runtime.addBuiltin(id)
  await runtime.setToken(id, `private-${id}-token`)
  calls.length = 0
  return { runtime, calls, confirm, store }
}
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.directory, { recursive: true, force: true }) } })
const identity: Route = url => url.pathname.endsWith('/me') ? json({ email: 'me@example.test' }) : url.pathname.endsWith('/user') ? json({ login: 'aksel-test' }) : url.pathname.endsWith('/auth.test') ? json({ ok: true, user: 'aksel', team: 'Acme', team_id: 'T123', user_id: 'U123' }) : json({})

describe('built-in connectors are ordinary connectors', () => {
  it('ship valid definitions, appear only once added, and need no model', async () => {
    for (const c of codeConnectors) expect(validateConnector(c.definition, true)).toEqual(c.definition)
    expect(() => validateConnector(codeConnectors[0].definition)).toThrow('built-in')
    const { runtime } = await connected('github', identity)
    expect(runtime.list().map(c => [c.definition.id, c.builtin, c.account, c.scopedSearch])).toEqual([['github', true, 'aksel-test', true]])
    runtime.remove('github')
    expect(runtime.list()).toEqual([])
  })
  it('keeps a token only when the service accepts it', async () => {
    const store = new Storage(mkdtempSync('/tmp/opencode/chatos-code-')); stores.push(store)
    const runtime = new Connectors(store, codec, async () => true, async () => '{}', (async () => json({}, 401)) as typeof fetch, async () => {})
    await runtime.addBuiltin('front')
    await expect(runtime.setToken('front', 'wrong')).rejects.toThrow(/didn't accept this token[\s\S]*HTTP 401/)
    expect(runtime.list()[0].hasToken).toBe(false)
    expect(store.secret('connector:front')).toBeUndefined()
  })
  it('built-ins are searched only when K is narrowed to them', async () => {
    const { runtime, calls } = await connected('github', identity)
    expect(await runtime.search('consent')).toEqual({ resources: [], errors: [] })
    expect(calls).toHaveLength(0)
  })
})

describe('Front', () => {
  it('reads a filtered inbox through the search path and follows only an opaque cursor', async () => {
    const { runtime, calls } = await connected('front', (url, init) => {
      expect(url.origin).toBe('https://api2.frontapp.com'); expect(init?.redirect).toBe('error')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer private-front-token')
      return json({ _results: [{ id: 'cnv_123', subject: 'A reply', status: 'assigned', recipient: { handle: 'carl@example.test' }, assignee: { username: 'aksel' }, tags: [{ name: 'mine' }] }], _pagination: { next: `https://company.api.frontapp.com${url.pathname}?page_token=opaque-next` } })
    })
    const page = await runtime.read({ connectorID: 'front', recipeID: 'inbox', query: 'to:me@example.test' })
    expect(decodeURIComponent(calls[0].url.pathname)).toBe('/conversations/search/to:me@example.test')
    expect(page.items[0]).toMatchObject({ id: 'cnv_123', title: 'A reply', subtitle: 'carl@example.test · → aksel' })
    expect(page.next).toBe('opaque-next')
    await runtime.read({ connectorID: 'front', recipeID: 'inbox', query: 'to:me@example.test' }, page.next)
    expect(calls[1].url.searchParams.get('page_token')).toBe('opaque-next')
    expect(JSON.stringify(page)).not.toContain('private-front-token')
  })
  it('reads a conversation with mail as messages and comments as notes, in order, without attachment URLs', async () => {
    const { runtime, calls } = await connected('front', url => {
      if (url.pathname === '/conversations/cnv_123') return json({ id: 'cnv_123', subject: 'Lab result', status: 'assigned', recipient: { handle: 'carl@example.test' } })
      if (url.pathname.endsWith('/messages')) return json({ _results: [{ id: 'msg_2', text: 'Second', is_inbound: true, created_at: 1700000200, recipients: [{ role: 'from', name: 'Carl', handle: 'carl@example.test' }], attachments: [{ filename: 'lab.pdf', url: 'https://secret-attachment-url' }] }, { id: 'msg_1', body: '<p>First</p><img src="https://tracking.test/x">', created_at: 1700000000, recipients: [] }] })
      if (url.pathname.endsWith('/comments')) return json({ _results: [{ id: 'com_1', body: 'Internal: call him', posted_at: 1700000100, author: { username: 'aksel' } }] })
      if (url.pathname === '/me') return identity(url)
      throw new Error(`Unexpected ${url.pathname}`)
    })
    const page = await runtime.read({ connectorID: 'front', recipeID: 'conversation', resourceID: 'cnv_123' })
    expect(page.items[0]).toMatchObject({ id: 'cnv_123', title: 'Lab result' })
    expect(page.messages.map(m => [m.kind, m.author, m.text.split('\n')[0]])).toEqual([['message', 'Team', 'First'], ['note', 'aksel', 'Internal: call him'], ['message', 'Carl', 'Second']])
    expect(page.messages[2].text).toContain('📎 lab.pdf')
    expect(JSON.stringify(page)).not.toMatch(/secret-attachment-url|tracking\.test|<p>/)
    expect(calls.every(c => (c.init?.method || 'GET') === 'GET')).toBe(true)
    await expect(runtime.read({ connectorID: 'front', recipeID: 'conversation', resourceID: '../../messages' })).rejects.toThrow()
  })
  it('replies and comments ask first with the exact body, as you, post once and are never retried', async () => {
    const posts: { path: string; body: string }[] = []
    const { runtime, confirm, calls } = await connected('front', (url, init) => {
      if (init?.method === 'POST') { posts.push({ path: url.pathname, body: String(init.body) }); return json({}, 202) }
      return identity(url, init)
    })
    runtime.saveSettings('front', { teammateID: 'tea_42' })
    await runtime.action({ connectorID: 'front', recipeID: 'conversation', resourceID: 'cnv_123' }, 'reply', 'Thanks, Carl')
    await runtime.action({ connectorID: 'front', recipeID: 'conversation', resourceID: 'cnv_123' }, 'comment', 'Called him')
    expect(posts).toEqual([{ path: '/conversations/cnv_123/messages', body: '{"body":"Thanks, Carl","author_id":"tea_42"}' }, { path: '/conversations/cnv_123/comments', body: '{"body":"Called him","author_id":"tea_42"}' }])
    expect(confirm.mock.calls.at(-1)?.[1]).toContain('"body":"Called him","author_id":"tea_42"')
    await expect(runtime.action({ connectorID: 'front', recipeID: 'conversation', resourceID: 'cnv_123' }, 'reply', '  ')).rejects.toThrow('Write something first')
    confirm.mockResolvedValueOnce(false)
    await expect(runtime.action({ connectorID: 'front', recipeID: 'conversation', resourceID: 'cnv_123' }, 'reply', 'Not this')).rejects.toThrow('cancelled')
    const failing = await connected('front', (url, init) => init?.method === 'POST' ? Promise.reject(new Error('socket')) : identity(url, init))
    await expect(failing.runtime.action({ connectorID: 'front', recipeID: 'conversation', resourceID: 'cnv_123' }, 'reply', 'Once')).rejects.toThrow('not been automatically retried')
    expect(failing.calls.filter(c => c.init?.method === 'POST')).toHaveLength(1)
    expect(calls.filter(c => c.init?.method === 'POST')).toHaveLength(2)
  })
  it('personal filters come only from values you set; bad values are refused', async () => {
    const { runtime } = await connected('front', identity)
    expect(runtime.list()[0].filters!.filter(f => f.ready).map(f => f.title)).toEqual(['Open mail'])
    runtime.saveSettings('front', { email: 'me@example.test', teammateID: 'tea_123', tagID: 'tag_abc' })
    expect(runtime.list()[0].filters!.every(f => f.ready)).toBe(true)
    expect(runtime.list()[0].settings!.find(s => s.key === 'teammateID')?.value).toBe('tea_123')
    expect(() => runtime.saveSettings('front', { teammateID: 'me is:trashed' })).toThrow('tea_')
    expect(frontFilters(frontIdentity({ email: '', teammateID: 'tea_1', tagID: '' })).find(f => f.title === 'Replies to my mail')?.query).toBe('author:tea_1 is:unreplied')
  })
  it('lists inboxes, and an inbox opens its open conversations through search, with paging', async () => {
    const { runtime, calls } = await connected('front', url => {
      if (url.pathname === '/me') return identity(url)
      if (url.pathname === '/inboxes') return json({ _results: [{ id: 'inb_2', name: 'Support', address: 'help@example.test' }, { id: 'inb_1', name: 'Billing', is_private: true }, { id: '../x', name: 'Bad' }] })
      if (url.pathname.startsWith('/conversations/search/')) return json({ _results: [{ id: 'cnv_9', subject: 'Invoice', status: 'unassigned' }], _pagination: { next: `https://api2.frontapp.com/conversations/search/inbox:inb_1%20is:open?page_token=more` } })
      throw new Error(`Unexpected ${url.pathname}`)
    })
    const inboxes = await runtime.read({ connectorID: 'front', recipeID: 'inboxes' })
    expect(inboxes.items.map(i => [i.id, i.title, i.subtitle])).toEqual([['inb_1', 'Billing', 'Private'], ['inb_2', 'Support', 'Shared · help@example.test']])
    expect((await runtime.read({ connectorID: 'front', recipeID: 'inboxes', query: 'help' })).items.map(i => i.id)).toEqual(['inb_2'])
    const page = await runtime.read({ connectorID: 'front', recipeID: 'inbox-conversations', parentID: 'inb_1' })
    expect(decodeURIComponent(calls.at(-1)!.url.pathname)).toBe('/conversations/search/inbox:inb_1 is:open')
    expect(page.items[0]).toMatchObject({ id: 'cnv_9', title: 'Invoice' })
    expect(page.next).toBe('more')
    await runtime.read({ connectorID: 'front', recipeID: 'inbox-conversations', parentID: 'inb_1', query: 'is:archived' })
    expect(decodeURIComponent(calls.at(-1)!.url.pathname)).toBe('/conversations/search/inbox:inb_1 is:archived')
    await expect(runtime.read({ connectorID: 'front', recipeID: 'inbox-conversations', parentID: 'inb_1 OR is:trashed' })).rejects.toThrow('inbox ID')
  })
  it('says when a thread is cut short and links the conversation in Front', async () => {
    const { runtime } = await connected('front', url => {
      if (url.pathname === '/me') return identity(url)
      if (url.pathname === '/conversations/cnv_123') return json({ id: 'cnv_123', subject: 'Long thread', status: 'assigned' })
      if (url.pathname.endsWith('/messages')) return json({ _results: [{ id: 'msg_1', text: 'Latest', created_at: 1700000000 }], _pagination: { next: 'https://api2.frontapp.com/conversations/cnv_123/messages?page_token=older' } })
      if (url.pathname.endsWith('/comments')) return json({}, 403)
      throw new Error(`Unexpected ${url.pathname}`)
    })
    const page = await runtime.read({ connectorID: 'front', recipeID: 'conversation', resourceID: 'cnv_123' })
    expect(page.items[0].url).toBe('https://app.frontapp.com/open/cnv_123')
    expect(page.messages.map(m => m.kind)).toEqual(['event', 'message'])
    expect(page.messages[0].text).toMatch(/Older messages[\s\S]*Comments could not be read[\s\S]*app\.frontapp\.com\/open\/cnv_123/)
  })
  it('turns email HTML into text and accepts only same-API pagination links', () => {
    const message = frontMessage({ id: 'msg_1', body: '<p>Hello &amp; welcome.</p><img src="https://tracking.test/pixel"><script>window.bad=true</script><a href="javascript:alert(1)">Readable link</a>' })
    expect(message.text).toContain('Hello & welcome.'); expect(message.text).toContain('Readable link')
    expect(message.text).not.toMatch(/<|tracking\.test|javascript:|window\.bad/)
    for (const url of ['https://evil.test/conversations?page_token=leak', 'https://api2.frontapp.com/messages?page_token=leak', 'https://token@api2.frontapp.com/conversations?page_token=leak', 'http://api2.frontapp.com/conversations?page_token=leak']) expect(frontCursor({ _pagination: { next: url } }, '/conversations')).toBeUndefined()
  })
})

describe('Slack and GitHub', () => {
  it('finds an existing DM by real name, never creates one, and caches the directory', async () => {
    const { runtime, calls } = await connected('slack', url => {
      if (url.pathname.endsWith('/auth.test')) return json({ ok: true, team_id: 'T123', user_id: 'U123' })
      if (url.pathname.endsWith('/users.list')) return json({ ok: true, members: [{ id: 'U456', name: 'carl', profile: { real_name: 'Carl Hansen', display_name: 'Carl' } }], response_metadata: {} })
      if (url.pathname.endsWith('/conversations.list')) return json({ ok: true, channels: [{ id: 'D456', user: 'U456' }], response_metadata: {} })
      throw new Error('Unexpected endpoint')
    })
    const result = await runtime.search('Carl', 'slack')
    expect(result.resources.find(r => r.title === 'DM Carl')).toMatchObject({ url: 'https://app.slack.com/client/T123/D456' })
    const before = calls.filter(c => !c.url.pathname.endsWith('search.messages')).length
    await runtime.read({ connectorID: 'slack', recipeID: 'dms', query: 'Hansen' })
    expect(calls.filter(c => !c.url.pathname.endsWith('search.messages')).length).toBe(before)
    expect(calls.every(c => (c.init?.method || 'GET') === 'GET')).toBe(true)
  })
  it('explains missing Slack scopes without leaking the response', async () => {
    const { runtime } = await connected('slack', url => url.pathname.endsWith('/auth.test') ? identity(url) : json({ ok: false, error: 'missing_scope', secret: 'must-not-leak' }))
    const error = await runtime.read({ connectorID: 'slack', recipeID: 'dms' }).catch(e => e as Error)
    expect(String(error)).toContain('users:read'); expect(String(error)).not.toContain('must-not-leak')
  })
  it('lists only the Slack channels you are in and reads a channel’s recent history, oldest first', async () => {
    const { runtime, calls } = await connected('slack', url => {
      if (url.pathname.endsWith('/auth.test')) return json({ ok: true, team_id: 'T123', user_id: 'U123' })
      if (url.pathname.endsWith('/users.conversations')) return json({ ok: true, channels: [{ id: 'C2', name: 'general', topic: { value: 'Company-wide' } }, { id: 'G1', name: 'design', is_private: true, purpose: { value: 'Pixels' } }, { id: 'C9', name: 'old', is_archived: true }, { id: 'bad', name: 'evil' }], response_metadata: {} })
      if (url.pathname.endsWith('/conversations.info')) return json({ ok: true, channel: { id: 'C2', name: 'general', topic: { value: 'Company-wide' }, num_members: 12 } })
      if (url.pathname.endsWith('/users.list')) return json({ ok: true, members: [{ id: 'U456', name: 'carl', profile: { display_name: 'Carl' } }], response_metadata: {} })
      if (url.pathname.endsWith('/conversations.history')) return json({ ok: true, messages: [{ ts: '1700000100.000200', user: 'U123', text: 'Thanks <@U456>, see <https://example.test|the doc>', reply_count: 2 }, { ts: '1700000000.000100', user: 'U456', text: 'Hello &amp; welcome' }, { ts: '1700000050.0', subtype: 'channel_join', user: 'U789', text: 'joined' }] })
      throw new Error('Unexpected endpoint')
    })
    const list = await runtime.read({ connectorID: 'slack', recipeID: 'channels' })
    expect(list.items.map(i => [i.id, i.title, i.subtitle])).toEqual([['G1', '#design', 'Private · Pixels'], ['C2', '#general', 'Company-wide']])
    const types = calls.find(c => c.url.pathname.endsWith('/users.conversations'))!.url.searchParams
    expect([types.get('types'), types.get('exclude_archived')]).toEqual(['public_channel,private_channel', 'true'])
    expect((await runtime.read({ connectorID: 'slack', recipeID: 'channels', query: '#gen' })).items.map(i => i.id)).toEqual(['C2'])
    const found = await runtime.search('design', 'slack')
    expect(found.resources.find(r => r.title === '#design')?.ref).toEqual({ connectorID: 'slack', recipeID: 'channel', resourceID: 'G1' })

    const page = await runtime.read({ connectorID: 'slack', recipeID: 'channel', resourceID: 'C2' })
    expect(page.items[0]).toMatchObject({ id: 'C2', title: '#general', url: 'https://app.slack.com/client/T123/C2' })
    expect(page.messages.map(m => [m.author, m.text])).toEqual([['Carl', 'Hello & welcome'], ['U123', 'Thanks @Carl, see the doc (https://example.test)\n\n↳ 2 replies (open in Slack)']])
    expect(calls.find(c => c.url.pathname.endsWith('/conversations.history'))!.url.searchParams.get('channel')).toBe('C2')
    await expect(runtime.read({ connectorID: 'slack', recipeID: 'channel', resourceID: '../evil' })).rejects.toThrow('Invalid Slack channel ID')
    expect(calls.every(c => (c.init?.method || 'GET') === 'GET')).toBe(true)
  })
  it('lists GitHub review requests for you and drops links that are not pull requests on github.com', async () => {
    const { runtime, calls } = await connected('github', url => {
      if (url.pathname === '/user') return json({ login: 'aksel-test' })
      return json({ items: [{ number: 42, title: 'Consent fix', state: 'open', html_url: 'https://github.com/acme/amino/pull/42' }, { number: 43, title: 'bad', html_url: 'https://evil.test/steal' }] })
    })
    const page = await runtime.read({ connectorID: 'github', recipeID: 'pulls' })
    expect(calls.at(-1)!.url.searchParams.get('q')).toBe('is:pr is:open review-requested:aksel-test')
    expect(new Headers(calls.at(-1)!.init?.headers).get('user-agent')).toBe('ChatOS')
    expect(page.items.map(i => [i.title, i.url])).toEqual([['#42 · Consent fix', 'https://github.com/acme/amino/pull/42']])
  })
})

describe('upgrading from separate services', () => {
  it('moves tokens and Front filter values across once, and old Front tiles become connector tiles', async () => {
    const store = new Storage(mkdtempSync('/tmp/opencode/chatos-code-')); stores.push(store)
    store.saveServices(JSON.stringify({ front: { url: 'https://app.frontapp.com/', front: { email: 'me@example.test', teammateID: 'tea_1', tagID: '' } }, github: { url: 'https://github.com/' } }), [{ id: 'front', encrypted: codec.encrypt('old-front-token') }])
    const runtime = new Connectors(store, codec, async () => true, async () => '{}', (async () => json({})) as typeof fetch, async () => {})
    expect(runtime.list().map(c => [c.definition.id, c.hasToken])).toEqual([['front', true], ['github', false]])
    expect(store.secret('service:front')).toBeUndefined()
    expect(runtime.list()[0].settings!.find(s => s.key === 'teammateID')?.value).toBe('tea_1')
    expect(readFileSync(store.backup()).includes(Buffer.from('old-front-token'))).toBe(false)
    runtime.remove('github')
    expect(new Connectors(store, codec, async () => true, async () => '{}').list().map(c => c.definition.id)).toEqual(['front'])

    const old = { ...desktopInitial(), workspaces: [{ id: 'w1', tileIDs: ['a', 'b'], focusedID: 'a', fullscreenID: null }], activeID: 'w1' }
    const tile = (id: string, extra: object) => ({ id, title: 'Front', status: 'visible', workspaceID: 'w1', draft: 'kept draft', context: [], lastUsed: 1, shelvedAt: 0, ...extra })
    const restored = restoreDesktop(serializeDesktop({ ...old, tiles: [tile('a', { key: 'front-list:is:open', kind: 'front-list', frontQuery: 'is:open' }), tile('b', { key: 'front:cnv_9', kind: 'front-conversation', conversationID: 'cnv_9', url: 'https://app.frontapp.com/open/cnv_9' })] } as never))
    expect(restored.tiles.map(t => [t.kind, t.resource, t.draft])).toEqual([['recipe', { connectorID: 'front', recipeID: 'inbox', query: 'is:open' }, 'kept draft'], ['recipe', { connectorID: 'front', recipeID: 'conversation', resourceID: 'cnv_9' }, 'kept draft']])
  })
})
