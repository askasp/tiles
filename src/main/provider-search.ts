import type { FrontDetail, FrontPage, ServiceID, ServiceResource, ServiceSearch } from '../shared/types'
import { frontCursor, frontMessage, frontSummary } from './front-data'

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const records = (v: unknown) => Array.isArray(v) ? v.map(record) : []
const text = (v: unknown, limit = 200) => typeof v === 'string' ? v.slice(0, limit) : ''
const roots = { slack: 'https://slack.com/api/', front: 'https://api2.frontapp.com/', github: 'https://api.github.com/' } as const
class SearchError extends Error {}

/** Read-only discovery. There are intentionally no create/send/update methods. */
export class ProviderSearch {
  private cache = new Map<string, { expires: number; value: Promise<Record<string, unknown>> }>()
  private blockedUntil = new Map<ServiceID, number>()
  constructor(private token: (id: ServiceID) => string | undefined, private fetcher: typeof fetch = fetch) {}
  invalidate(id: ServiceID) { for (const key of this.cache.keys()) if (key.startsWith(`${id}:`)) this.cache.delete(key); this.blockedUntil.delete(id) }
  private async get(id: ServiceID, path: string, query: Record<string, string> = {}, ttl = 60_000) {
    const token = this.token(id)
    if (!token) throw new SearchError(`Save a ${id === 'github' ? 'GitHub' : id === 'slack' ? 'Slack user' : 'Front'} API token in Settings to search this source.`)
    if ((this.blockedUntil.get(id) || 0) > Date.now()) throw new SearchError('This source is rate limited. Try again later.')
    const url = new URL(path, roots[id])
    // No caller or API pagination link can change the credential destination.
    if (url.origin !== new URL(roots[id]).origin) throw new Error('Invalid provider endpoint')
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const key = `${id}:${url.href}`
    const cached = this.cache.get(key)
    if (ttl > 0 && cached && cached.expires > Date.now()) return cached.value
    const value = (async () => {
      let response: Response
      try { response = await this.fetcher(url.href, { headers: { Authorization: `Bearer ${token}`, Accept: id === 'github' ? 'application/vnd.github+json' : 'application/json', 'User-Agent': 'ChatOS/0.1', ...(id === 'github' && { 'X-GitHub-Api-Version': '2026-03-10' }) }, redirect: 'error', signal: AbortSignal.timeout(12_000) }) }
      catch { throw new SearchError(`Could not reach ${id}. Check connectivity and retry.`) }
      if (response.status === 429) { this.blockedUntil.set(id, Date.now() + Math.min(300, Math.max(10, Number(response.headers.get('retry-after')) || 60)) * 1000); throw new SearchError('This source is rate limited. Try again later.') }
      if (response.status === 401 || response.status === 403) throw new SearchError(id === 'front' ? 'Check your Front token and conversations:read / messages:read scopes in Settings. Private inboxes also require account access.' : `Check the ${id} token, repository access, and read scopes in Settings.`)
      if (id === 'front' && response.status === 301) throw new SearchError('This Front conversation was merged. Use Open in Front to find its new location.')
      if (!response.ok) throw new SearchError(`Source search failed (HTTP ${response.status}). Check the query and token scopes.`)
      const result = record(await response.json().catch(() => { throw new SearchError('The source returned an invalid response. Retry later.') }))
      if (id === 'slack' && result.ok !== true) {
        if (result.error === 'missing_scope') throw new SearchError('Slack scopes needed: users:read + im:read for DMs; search:read for message/mention search.')
        if (result.error === 'ratelimited') { this.blockedUntil.set(id, Date.now() + 60_000); throw new SearchError('Slack is rate limited. Try again later.') }
        throw new SearchError('Slack rejected the search. Check user-token type and read scopes in Settings.')
      }
      return result
    })()
    if (this.cache.size >= 80) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(key, { expires: Date.now() + ttl, value })
    void value.catch(() => { if (this.cache.get(key)?.value === value) this.cache.delete(key) })
    return value
  }
  private frontParams(cursor?: string) {
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096 || /[\r\n\x00]/.test(cursor))) throw new SearchError('Invalid Front page cursor')
    return { limit: '25', ...(cursor && { page_token: cursor }) }
  }
  async frontList(input: { query: string; cursor?: string }): Promise<FrontPage> {
    if (typeof input.query !== 'string' || input.query.length > 300) throw new SearchError('Keep Front filters under 300 characters')
    const query = input.query.trim(), path = query ? `conversations/search/${encodeURIComponent(query)}` : 'conversations'
    const data = await this.get('front', path, this.frontParams(input.cursor), 0)
    return { items: records(data._results).slice(0, 25).filter(c => /^cnv_[a-z0-9]+$/i.test(text(c.id))).map(frontSummary), next: frontCursor(data, path) }
  }
  async frontDetail(input: { id: string; cursor?: string }): Promise<FrontDetail> {
    if (typeof input.id !== 'string' || !/^cnv_[a-z0-9]+$/i.test(input.id)) throw new SearchError('Invalid Front conversation ID')
    const path = `conversations/${input.id}/messages`
    const [conversation, messages] = await Promise.all([
      this.get('front', `conversations/${input.id}`, {}, 0),
      this.get('front', path, { ...this.frontParams(input.cursor), sort_by: 'created_at', sort_order: 'desc' }, 0),
    ])
    if (conversation.id !== input.id) throw new SearchError('Front returned a different conversation. Open in Front to check merged threads.')
    return { conversation: frontSummary(conversation), messages: records(messages._results).slice(0, 25).filter(m => /^msg_[a-z0-9]+$/i.test(text(m.id))).map(frontMessage), next: frontCursor(messages, path) }
  }
  private async slackPages(method: 'users.list' | 'conversations.list', field: string, query: Record<string, string> = {}) {
    const result: Record<string, unknown>[] = []
    let cursor = ''
    for (let page = 0; page < 10; page++) {
      const data = await this.get('slack', method, { ...query, limit: '200', ...(cursor && { cursor }) }, 300_000)
      result.push(...records(data[field]))
      cursor = text(record(data.response_metadata).next_cursor, 1000)
      if (!cursor) break
    }
    return { items: result, more: !!cursor }
  }
  async search(raw: string): Promise<ServiceSearch> {
    if (typeof raw !== 'string' || raw.length > 300) return { resources: [], error: 'Keep source searches under 300 characters.' }
    const match = raw.trim().match(/^(dm|slack|mail|front|pr|github)(?:\s+(.*))?$/i)
    if (!match) return { resources: [] }
    const source = match[1].toLowerCase(), query = (match[2] || '').trim()
    try {
      if (source === 'dm') {
        const [auth, users, channels] = await Promise.all([this.get('slack', 'auth.test', {}, 300_000), this.slackPages('users.list', 'members'), this.slackPages('conversations.list', 'channels', { types: 'im', exclude_archived: 'true' })])
        const team = text(auth.team_id)
        if (!/^[A-Z0-9]+$/.test(team)) throw new SearchError('Slack did not identify a workspace. Use a workspace-scoped user token.')
        const people = new Map(users.items.filter(u => !u.deleted && !u.is_bot).map(u => [text(u.id), u]))
        const words = query.toLowerCase().split(/\s+/).filter(Boolean)
        const resources: ServiceResource[] = []
        for (const channel of channels.items) {
          const user = people.get(text(channel.user)), profile = record(user?.profile), id = text(channel.id)
          if (!user || !/^D[A-Z0-9]+$/.test(id)) continue
          const name = text(profile.display_name) || text(profile.real_name) || text(user.real_name) || text(user.name)
          const haystack = `${name} ${text(user.name)} ${text(profile.real_name)}`.toLowerCase()
          if (words.every(word => haystack.includes(word))) resources.push({ service: 'slack', title: `DM ${name}`, url: `https://app.slack.com/client/${team}/${id}`, description: 'Existing Slack DM · nothing created or sent' })
        }
        return { resources: resources.slice(0, 20), more: users.more || channels.more || resources.length > 20 }
      }
      if (source === 'slack') {
        let search = query
        if (query.toLowerCase() === 'mentions') {
          const auth = await this.get('slack', 'auth.test', {}, 300_000), user = text(auth.user_id)
          if (!/^[A-Z0-9]+$/.test(user)) throw new SearchError('Use a Slack user token for your mentions.')
          search = `<@${user}>`
        }
        if (!search) return { resources: [], error: 'Try “dm Carl”, “slack mentions”, or “slack search terms”.' }
        const data = await this.get('slack', 'search.messages', { query: search, count: '20', sort: 'timestamp', sort_dir: 'desc' })
        const messages = record(data.messages)
        const resources = records(messages.matches).flatMap(m => {
          const url = text(m.permalink, 2000)
          try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || !(parsed.hostname === 'slack.com' || parsed.hostname.endsWith('.slack.com')) || parsed.username || parsed.password) return [] } catch { return [] }
          return [{ service: 'slack' as const, title: `${text(record(m.channel).name) || 'Slack'} · ${text(m.text, 120) || 'Message'}`, url, description: 'Slack message / thread · opens in the web tile' }]
        })
        return { resources, more: Number(messages.total) > resources.length }
      }
      if (source === 'mail' || source === 'front') {
        const data = await this.get('front', query ? `conversations/search/${encodeURIComponent(query)}` : 'conversations', { limit: '20' })
        const resources = records(data._results).flatMap(c => {
          const id = text(c.id)
          if (!/^cnv_[a-z0-9]+$/i.test(id)) return []
          return [{ service: 'front' as const, title: text(c.subject) || 'Untitled conversation', url: `https://app.frontapp.com/open/${id}`, description: `Front · ${text(record(c.recipient).handle)} · ${text(c.status)}` }]
        })
        return { resources, more: !!record(data._pagination).next }
      }
      let search = query
      if (!query || /^(reviews?|review requested)$/i.test(query)) {
        const user = await this.get('github', 'user', {}, 300_000), login = text(user.login)
        if (!/^[a-z0-9-]+$/i.test(login)) throw new SearchError('GitHub did not identify the account.')
        search = `is:open review-requested:${login}`
      }
      const data = await this.get('github', 'search/issues', { q: `is:pr ${search}`, per_page: '20', sort: 'updated', order: 'desc' })
      const resources = records(data.items).flatMap(item => {
        const url = text(item.html_url, 2000)
        try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password || !/^\/[^/]+\/[^/]+\/pull\/\d+/.test(parsed.pathname)) return [] } catch { return [] }
        return [{ service: 'github' as const, title: `PR #${Number(item.number)} · ${text(item.title)}`, url, description: `GitHub · ${new URL(url).pathname.split('/').slice(1, 3).join('/')} · ${text(item.state)}` }]
      })
      return { resources, more: Number(data.total_count) > resources.length || data.incomplete_results === true }
    } catch (error) { return { resources: [], error: error instanceof SearchError ? error.message : 'Source search failed. Check connectivity and retry.' } }
  }
}
