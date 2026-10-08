import { record, records, text, webURL, type CodeConnector, type CodeContext } from './types'

/** Slack answers HTTP 200 with `ok: false`; turn that into an error you can act on. */
async function slack(context: CodeContext, method: string, query: Record<string, string> = {}, ttl?: number) {
  const data = await context.get(`/${method}`, query, ttl)
  if (data.ok === true) return data
  if (data.error === 'missing_scope') throw new Error('Slack token is missing a scope: users:read + im:read find DMs, search:read finds messages.')
  if (data.error === 'not_allowed_token_type') throw new Error('Use a Slack user token (xoxp-…); bot tokens cannot search.')
  if (data.error === 'invalid_auth' || data.error === 'token_revoked' || data.error === 'not_authed') throw new Error('Slack rejected the token. Paste a current user token.')
  throw new Error(`Slack answered “${text(data.error, 80) || 'error'}”.`)
}
async function pages(context: CodeContext, method: string, field: string, query: Record<string, string>) {
  const result: Record<string, unknown>[] = []
  let cursor = ''
  for (let page = 0; page < 10; page++) {
    const data = await slack(context, method, { ...query, limit: '200', ...(cursor && { cursor }) }, 300_000)
    result.push(...records(data[field], 1000))
    cursor = text(record(data.response_metadata).next_cursor, 1000)
    if (!cursor) break
  }
  return result
}

/** Slack: find existing DMs and messages; they open in Slack's own page, where you reply. */
export const slackConnector: CodeConnector = {
  hint: 'DMs and mentions',
  definition: {
    version: 1, id: 'slack', name: 'Slack', baseURL: 'https://slack.com/api',
    auth: { type: 'bearer', help: 'Create a Slack app → OAuth & Permissions → User Token Scopes: users:read and im:read (DMs), search:read (messages). Install it and paste the User OAuth Token (xoxp-…).' },
    operations: [
      { id: 'dms', label: 'List DMs', method: 'GET', effect: 'read', path: '/conversations.list', query: { types: 'im', cursor: '{cursor}' } },
      { id: 'messages', label: 'Search messages', method: 'GET', effect: 'read', path: '/search.messages', query: { query: '{query}', count: '20', sort: 'timestamp', sort_dir: 'desc' } },
    ],
    recipes: [
      { id: 'dms', label: 'DMs', shape: 'collection', view: 'list', operation: 'dms', searchOperation: 'dms', items: 'channels', idField: 'id', titleField: 'user', urlField: 'url' },
      { id: 'messages', label: 'Messages', shape: 'collection', view: 'list', operation: 'messages', searchOperation: 'messages', items: 'messages.matches', idField: 'iid', titleField: 'text', subtitleField: 'channel.name', urlField: 'permalink' },
    ],
  },
  filters: () => [{ title: 'Mentions', recipeID: 'messages', query: 'mentions', ready: true }],
  async validate(context) {
    const auth = await slack(context, 'auth.test')
    return [text(auth.user), text(auth.team)].filter(Boolean).join(' · ') || 'Slack user token'
  },
  async read(recipe, ref, _cursor, context) {
    const query = ref.query?.trim() || ''
    if (recipe.id === 'dms') {
      const [auth, users, channels] = await Promise.all([slack(context, 'auth.test', {}, 300_000), pages(context, 'users.list', 'members', {}), pages(context, 'conversations.list', 'channels', { types: 'im', exclude_archived: 'true' })])
      const team = text(auth.team_id)
      if (!/^[A-Z0-9]+$/.test(team)) throw new Error('Slack did not name a workspace. Use a workspace user token.')
      const people = new Map(users.filter(u => !u.deleted && !u.is_bot).map(u => [text(u.id), u]))
      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
      const items = channels.flatMap(channel => {
        const user = people.get(text(channel.user)), profile = record(user?.profile), id = text(channel.id)
        if (!user || !/^D[A-Z0-9]+$/.test(id)) return []
        const name = text(profile.display_name) || text(profile.real_name) || text(user.real_name) || text(user.name)
        if (!words.every(word => `${name} ${text(user.name)} ${text(profile.real_name)}`.toLowerCase().includes(word))) return []
        return [{ id, title: `DM ${name}`, subtitle: 'Existing DM · opens in Slack', text: '', url: `https://app.slack.com/client/${team}/${id}`, fields: [] }]
      })
      return { items: items.slice(0, 50), messages: [] }
    }
    let search = query
    if (!query || /^(mentions|@me)$/i.test(query)) {
      const auth = await slack(context, 'auth.test', {}, 300_000), user = text(auth.user_id)
      if (!/^[A-Z0-9]+$/.test(user)) throw new Error('Use a Slack user token to find your mentions.')
      search = `<@${user}>`
    }
    const data = await slack(context, 'search.messages', { query: search, count: '20', sort: 'timestamp', sort_dir: 'desc' })
    const items = records(record(data.messages).matches, 20).flatMap(m => {
      const url = webURL(m.permalink, ['slack.com'])
      return url ? [{ id: url, title: text(m.text, 160) || 'Message', subtitle: `#${text(record(m.channel).name) || 'Slack'} · ${text(m.username) || text(m.user)}`, text: '', url, time: typeof m.ts === 'string' ? new Date(Number(m.ts) * 1000).toISOString() : undefined, fields: [] }] : []
    })
    return { items, messages: [] }
  },
}
