import { describe, expect, it } from 'vitest'
import { ProviderSearch } from '../src/main/provider-search'

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
describe('read-only token-backed discovery', () => {
  it('finds an existing DM by real name, uses headers only, and caches read requests', async () => {
    const calls: { path: string; method: string; token: string; redirect?: RequestRedirect }[] = []
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input)); calls.push({ path: url.pathname, method: init?.method || 'GET', token: new Headers(init?.headers).get('authorization') || '', redirect: init?.redirect })
      expect(url.href).not.toContain('private-user-token')
      if (url.pathname.endsWith('/auth.test')) return json({ ok: true, team_id: 'T123', user_id: 'U123' })
      if (url.pathname.endsWith('/users.list')) return json({ ok: true, members: [{ id: 'U456', name: 'carl', profile: { real_name: 'Carl Hansen', display_name: 'Carl' } }], response_metadata: {} })
      if (url.pathname.endsWith('/conversations.list')) return json({ ok: true, channels: [{ id: 'D456', user: 'U456', is_im: true }], response_metadata: {} })
      throw new Error('Unexpected mutation or endpoint')
    }
    const search = new ProviderSearch(() => 'private-user-token', fetcher)
    const result = await search.search('dm Carl')
    expect(result.resources).toEqual([{ service: 'slack', title: 'DM Carl', url: 'https://app.slack.com/client/T123/D456', description: 'Existing Slack DM · nothing created or sent' }])
    expect(JSON.stringify(result)).not.toContain('private-user-token')
    await search.search('dm Hansen')
    expect(calls).toHaveLength(3)
    expect(calls.every(c => c.method === 'GET' && c.redirect === 'error' && c.token === 'Bearer private-user-token')).toBe(true)
  })
  it('returns Front conversation URLs and respects the documented search path', async () => {
    const fetcher: typeof fetch = async input => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://api2.frontapp.com')
      expect(decodeURIComponent(url.pathname)).toBe('/conversations/search/from:furst')
      return json({ _results: [{ id: 'cnv_abc123', subject: 'Lab result', recipient: { handle: 'furst@example.test' }, status: 'assigned' }] })
    }
    const result = await new ProviderSearch(() => 'front-token', fetcher).search('mail from:furst')
    expect(result.resources[0]).toEqual({ service: 'front', title: 'Lab result', url: 'https://app.frontapp.com/open/cnv_abc123', description: 'Front · furst@example.test · assigned' })
  })
  it('finds GitHub review requests for the authenticated user and ignores hostile links', async () => {
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input)); expect(url.origin).toBe('https://api.github.com')
      expect(init?.redirect).toBe('error')
      if (url.pathname === '/user') return json({ login: 'aksel-test' })
      expect(url.pathname).toBe('/search/issues'); expect(url.searchParams.get('q')).toBe('is:pr is:open review-requested:aksel-test')
      return json({ total_count: 2, items: [{ number: 42, title: 'Consent fix', state: 'open', html_url: 'https://github.com/acme/amino/pull/42' }, { number: 43, title: 'bad', html_url: 'https://evil.test/steal' }] })
    }
    const result = await new ProviderSearch(() => 'github-token', fetcher).search('pr reviews')
    expect(result.resources).toHaveLength(1); expect(result.resources[0].title).toContain('Consent fix')
  })
  it('does not create missing DMs and reports missing scopes without leaking response data', async () => {
    const fetcher: typeof fetch = async () => json({ ok: false, error: 'missing_scope', secret: 'must-not-leak' })
    const result = await new ProviderSearch(() => 'token', fetcher).search('dm Carl')
    expect(result.resources).toEqual([]); expect(result.error).toContain('users:read')
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
    expect((await new ProviderSearch(() => undefined, fetcher).search('dm Carl')).error).toContain('Settings')
  })
  it('backs off on rate limits and sanitizes malformed responses', async () => {
    let calls = 0
    const fetcher: typeof fetch = async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '60' } }) }
    const search = new ProviderSearch(() => 'token', fetcher)
    await search.search('pr repo:acme/amino'); await search.search('pr repo:acme/health')
    expect(calls).toBe(1)
    const malformed: typeof fetch = async () => new Response('token-that-should-never-appear', { status: 200 })
    const result = await new ProviderSearch(() => 'token', malformed).search('pr consent')
    expect(result.error).toContain('invalid response'); expect(JSON.stringify(result)).not.toContain('token-that-should-never-appear')
  })
})
