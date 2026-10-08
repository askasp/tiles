import { record, records, text, webURL, type CodeConnector, type CodeContext } from './types'

/** Slack answers HTTP 200 with `ok: false`; turn that into an error you can act on. */
async function slack(context: CodeContext, method: string, query: Record<string, string> = {}, ttl?: number) {
  const data = await context.get(`/${method}`, query, ttl)
  if (data.ok === true) return data
  if (data.error === 'missing_scope') throw new Error('Slack token is missing a scope: users:read + im:read find DMs, channels:read + groups:read list channels, channels:history + groups:history read them, search:read finds messages.')
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

const channelID = /^[CG][A-Z0-9]+$/
const slackTime = (ts: unknown) => typeof ts === 'string' && /^\d+(\.\d+)?$/.test(ts) ? new Date(Number(ts) * 1000).toISOString() : undefined
/** Slack's markup (<@U1>, <#C1|name>, <https://x|label>, <!here>) as plain text. */
function plain(value: string, people: Map<string, Record<string, unknown>>) {
  return value.replace(/<([^<>]+)>/g, (_all, inner: string) => {
    const [target, label] = inner.split('|', 2)
    if (target.startsWith('@')) { const user = people.get(target.slice(1)), profile = record(user?.profile); return `@${label || text(profile.display_name) || text(profile.real_name) || text(user?.name) || target.slice(1)}` }
    if (target.startsWith('#')) return `#${label || target.slice(1)}`
    if (target.startsWith('!')) return `@${label || target.slice(1).split('^')[0]}`
    return label ? `${label} (${target})` : target
  }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
const personName = (user: Record<string, unknown> | undefined) => { const profile = record(user?.profile); return text(profile.display_name) || text(profile.real_name) || text(user?.real_name) || text(user?.name) }

/** Slack: find existing DMs and messages, which open in Slack's own page, where you reply; read the channels you are in. */
export const slackConnector: CodeConnector = {
  hint: 'DMs, channels and mentions',
  definition: {
    version: 1, id: 'slack', name: 'Slack', baseURL: 'https://slack.com/api',
    auth: { type: 'bearer', help: 'Create a Slack app → OAuth & Permissions → User Token Scopes: users:read and im:read (DMs), channels:read, groups:read, channels:history and groups:history (channels you are in), search:read (messages). Install it and paste the User OAuth Token (xoxp-…).' },
    operations: [
      { id: 'dms', label: 'List DMs', method: 'GET', effect: 'read', path: '/conversations.list', query: { types: 'im', cursor: '{cursor}' } },
      { id: 'messages', label: 'Search messages', method: 'GET', effect: 'read', path: '/search.messages', query: { query: '{query}', count: '20', sort: 'timestamp', sort_dir: 'desc' } },
      { id: 'channels', label: 'List my channels', method: 'GET', effect: 'read', path: '/users.conversations', query: { types: 'public_channel,private_channel', exclude_archived: 'true', cursor: '{cursor}' } },
      { id: 'channel', label: 'Read channel history', method: 'GET', effect: 'read', path: '/conversations.history', query: { channel: '{id}', limit: '50' } },
    ],
    recipes: [
      { id: 'dms', label: 'DMs', shape: 'collection', view: 'list', operation: 'dms', searchOperation: 'dms', items: 'channels', idField: 'id', titleField: 'user', urlField: 'url' },
      { id: 'messages', label: 'Messages', shape: 'collection', view: 'list', operation: 'messages', searchOperation: 'messages', items: 'messages.matches', idField: 'iid', titleField: 'text', subtitleField: 'channel.name', urlField: 'permalink' },
      { id: 'channels', label: 'Channels', shape: 'collection', view: 'list', operation: 'channels', searchOperation: 'channels', itemRecipe: 'channel', items: 'channels', idField: 'id', titleField: 'name', subtitleField: 'topic.value' },
      { id: 'channel', label: 'Channel', shape: 'item', view: 'conversation', operation: 'channel', idField: 'channel', titleField: 'channel', messages: 'messages', messageTextField: 'text', messageAuthorField: 'user', messageTimeField: 'ts' },
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
    if (recipe.id === 'channels') {
      const channels = await pages(context, 'users.conversations', 'channels', { types: 'public_channel,private_channel', exclude_archived: 'true' })
      const words = query.toLowerCase().replace(/^#/, '').split(/\s+/).filter(Boolean)
      const items = channels.flatMap(channel => {
        const id = text(channel.id), name = text(channel.name, 100), topic = text(record(channel.topic).value, 200), purpose = text(record(channel.purpose).value, 200)
        if (!channelID.test(id) || !name || channel.is_archived === true) return []
        if (!words.every(word => `${name} ${topic} ${purpose}`.toLowerCase().includes(word))) return []
        return [{ id, title: `#${name}`, subtitle: [channel.is_private === true ? 'Private' : '', topic || purpose].filter(Boolean).join(' · ') || 'Channel', text: '', fields: [] }]
      }).sort((a, b) => a.title.localeCompare(b.title))
      return { items: items.slice(0, 200), messages: [] }
    }
    if (recipe.id === 'channel') {
      const id = ref.resourceID || ''
      if (!channelID.test(id)) throw new Error('Invalid Slack channel ID')
      const [auth, info, history, users] = await Promise.all([
        slack(context, 'auth.test', {}, 300_000), slack(context, 'conversations.info', { channel: id, include_num_members: 'true' }, 300_000),
        slack(context, 'conversations.history', { channel: id, limit: '50' }), pages(context, 'users.list', 'members', {}),
      ])
      const channel = record(info.channel), team = text(auth.team_id)
      if (text(channel.id) !== id) throw new Error('Slack returned a different channel. Open it in Slack to check.')
      const people = new Map(users.map(u => [text(u.id), u]))
      const messages = records(history.messages, 50).filter(m => !m.subtype || ['thread_broadcast', 'bot_message', 'file_share', 'me_message'].includes(text(m.subtype))).map(m => {
        const replies = typeof m.reply_count === 'number' && m.reply_count > 0 ? `\n\n↳ ${m.reply_count} ${m.reply_count === 1 ? 'reply' : 'replies'} (open in Slack)` : ''
        const files = records(m.files, 10).map(f => `📎 ${text(f.name) || text(f.title) || 'file'}`).join('\n')
        return { at: Number(m.ts) || 0, kind: 'message' as const, text: [plain(text(m.text, 50_000), people), files].filter(Boolean).join('\n\n') + replies, author: personName(people.get(text(m.user))) || text(m.username) || text(record(m.bot_profile).name) || text(m.user) || 'Slack', time: slackTime(m.ts) || '' }
      })
      const topic = text(record(channel.topic).value, 300), purpose = text(record(channel.purpose).value, 300)
      return {
        items: [{ id, title: `#${text(channel.name, 100) || id}`, subtitle: [channel.is_private === true ? 'Private channel' : 'Channel', topic].filter(Boolean).join(' · '), text: purpose, ...(/^[A-Z0-9]+$/.test(team) && { url: `https://app.slack.com/client/${team}/${id}` }),
          fields: [...(typeof channel.num_members === 'number' ? [{ label: 'Members', value: String(channel.num_members), kind: 'number' as const }] : [])] }],
        messages: messages.sort((a, b) => a.at - b.at).map(({ at: _at, ...m }) => m),
      }
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
