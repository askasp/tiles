import { describe, expect, it } from 'vitest'
import { ProviderSearch } from '../src/main/provider-search'
import { frontCursor, frontMessage } from '../src/main/front-data'
import { frontFilters, frontIdentity } from '../src/shared/front'
import { browserTile, desktopInitial, frontConversationTile, frontInboxTile, openTile, restoreDesktop, serializeDesktop, shelfTile } from '../src/shared/tiles'

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
describe('Front native data reads', () => {
  it('reads a filtered inbox and follows only an opaque cursor on the fixed API host', async () => {
    const calls: string[] = []
    const fetcher: typeof fetch = async (input, options) => {
      const url = new URL(String(input)); calls.push(url.href)
      expect(url.origin).toBe('https://api2.frontapp.com')
      expect(options?.method || 'GET').toBe('GET'); expect(options?.redirect).toBe('error')
      expect(new Headers(options?.headers).get('authorization')).toBe('Bearer private-front-token')
      expect(url.href).not.toContain('private-front-token')
      expect(decodeURIComponent(url.pathname)).toBe('/conversations/search/to:me@example.test')
      return json({ _results: [{ id: 'cnv_123', subject: 'A reply', status: 'assigned', recipient: { handle: 'carl@example.test' }, assignee: { username: 'aksel' }, tags: [{ name: 'mine' }] }], _pagination: { next: `https://company.api.frontapp.com${url.pathname}?page_token=opaque-next` } })
    }
    const provider = new ProviderSearch(() => 'private-front-token', fetcher)
    const page = await provider.frontList({ query: 'to:me@example.test' })
    expect(page.items[0]).toMatchObject({ id: 'cnv_123', subject: 'A reply', tags: ['mine'], assignee: 'aksel' })
    expect(page.next).toBe('opaque-next')
    await provider.frontList({ query: 'to:me@example.test', cursor: page.next })
    expect(new URL(calls[1]).searchParams.get('page_token')).toBe('opaque-next')
  })
  it('refresh reads fresh data and fetches conversation/messages, never seen/reply endpoints', async () => {
    const paths: string[] = []
    const fetcher: typeof fetch = async input => {
      const url = new URL(String(input)); paths.push(url.pathname)
      if (url.pathname === '/conversations/cnv_123') return json({ id: 'cnv_123', subject: 'Direct conversation', status: 'assigned' })
      expect(url.pathname).toBe('/conversations/cnv_123/messages')
      return json({ _results: [{ id: 'msg_123', subject: 'Direct conversation', text: 'Actual reply', is_inbound: true, created_at: 1700000000, recipients: [{ role: 'from', handle: 'sender@example.test' }], attachments: [{ filename: 'lab.pdf', size: 4096, url: 'https://secret-attachment-url' }] }] })
    }
    const provider = new ProviderSearch(() => 'token', fetcher)
    const detail = await provider.frontDetail({ id: 'cnv_123' })
    expect(detail.messages[0]).toMatchObject({ text: 'Actual reply', inbound: true, createdAt: 1700000000000, attachments: [{ name: 'lab.pdf', size: 4096 }] })
    expect(JSON.stringify(detail)).not.toContain('secret-attachment-url')
    await provider.frontDetail({ id: 'cnv_123' })
    expect(paths).toHaveLength(4)
  })
  it('converts email HTML to safe text and never returns executable markup or remote image URLs', () => {
    const message = frontMessage({ id: 'msg_1', body: '<p>Hello &amp; welcome.</p><img src="https://tracking.test/pixel"><script>window.bad=true</script><iframe src="https://tracking.test/frame"></iframe><p>Next line</p><a href="javascript:alert(1)">Readable link</a>' })
    expect(message.text).toContain('Hello & welcome.')
    expect(message.text).toContain('Next line')
    expect(message.text).toContain('Readable link')
    expect(message.text).not.toMatch(/<|tracking\.test|javascript:|window\.bad/)
    expect(frontMessage({ id: 'msg_2', text: 'Keep readable', created_at: Number.MAX_VALUE }).createdAt).toBeUndefined()
  })
  it('rejects missing tokens, insufficient scopes, injected IDs and hostile pagination', async () => {
    const provider = new ProviderSearch(() => undefined)
    await expect(provider.frontList({ query: 'is:open' })).rejects.toThrow('Front API token')
    await expect(provider.frontDetail({ id: '../../messages/delete' })).rejects.toThrow('Invalid Front')
    const forbidden: typeof fetch = async () => new Response('', { status: 403 })
    await expect(new ProviderSearch(() => 'token', forbidden).frontDetail({ id: 'cnv_123' })).rejects.toThrow('messages:read')
    for (const url of ['https://evil.test/conversations?page_token=leak', 'https://api2.frontapp.com/messages?page_token=leak', 'https://token@api2.frontapp.com/conversations?page_token=leak', 'http://api2.frontapp.com/conversations?page_token=leak']) expect(frontCursor({ _pagination: { next: url } }, 'conversations')).toBeUndefined()
  })
})

describe('Front native resource identity and personal filters', () => {
  it('an API reader upgrades an existing web conversation without duplicating or moving it', () => {
    let state = openTile(desktopInitial(), browserTile('https://app.frontapp.com/open/cnv_123'))
    const id = state.tiles[0].id, workspace = state.activeID
    state = openTile(state, frontConversationTile('cnv_123', 'Lab reply'))
    expect(state.tiles).toHaveLength(1); expect(state.tiles[0].id).toBe(id)
    expect(state.tiles[0].kind).toBe('front-conversation'); expect(state.activeID).toBe(workspace)
    state = openTile(state, browserTile('https://app.frontapp.com/open/cnv_123#message'))
    expect(state.tiles).toHaveLength(1)
    state = shelfTile(state, id)
    const restored = restoreDesktop(serializeDesktop(state))
    expect(restored.tiles[0].conversationID).toBe('cnv_123'); expect(restored.tiles[0].status).toBe('shelf')
  })
  it('filtered inboxes persist as unique reusable resources', () => {
    let state = openTile(desktopInitial(), frontInboxTile(' to:me@example.test '))
    state = openTile(state, frontInboxTile('to:me@example.test'))
    expect(state.tiles).toHaveLength(1)
    state = openTile(state, frontInboxTile('tag:tag_mine'))
    const restored = restoreDesktop(serializeDesktop(state))
    expect(restored.tiles.map(t => t.frontQuery)).toEqual(['to:me@example.test', 'tag:tag_mine'])
  })
  it('makes addressed/assigned/mention/tag/reply filters only from configured identity', () => {
    const identity = frontIdentity({ email: 'me@example.test', teammateID: 'tea_123', tagID: 'tag_abc' })
    expect(frontFilters(identity).every(f => f.ready)).toBe(true)
    expect(frontFilters(identity).find(f => f.title === 'Replies to my mail')?.query).toBe('author:tea_123 is:unreplied')
    expect(frontFilters().filter(f => f.ready)).toHaveLength(1)
    expect(() => frontIdentity({ ...identity, teammateID: 'me is:trashed' })).toThrow()
  })
})
