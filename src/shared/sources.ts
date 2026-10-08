import type { TileInput } from './tiles'

export const sources = [
  { id: 'opencode', name: 'OpenCode', hint: 'Projects and sessions', prefix: 'opencode', kinds: ['projects', 'project', 'session', 'review', 'details'], hosts: [] },
  { id: 'files', name: 'Files', hint: 'Folders and text files', prefix: 'files', kinds: ['folder', 'file'], hosts: [] },
  { id: 'front', name: 'Front', hint: 'Inboxes and conversations', prefix: 'mail', kinds: ['front-list', 'front-conversation'], hosts: ['frontapp.com', 'front.com'] },
  { id: 'slack', name: 'Slack', hint: 'DMs and mentions', prefix: 'slack', kinds: [], hosts: ['slack.com'] },
  { id: 'github', name: 'GitHub', hint: 'Repositories and PRs', prefix: 'pr', kinds: [], hosts: ['github.com'] },
  { id: 'web', name: 'Web', hint: 'One tile per URL', prefix: 'web', kinds: ['browser'], hosts: [] },
] as const
export type SourceID = typeof sources[number]['id'] | `connector:${string}`

/** Source, resource and action are separate from tile ownership and layout. */
export function resourceSource(tile: TileInput): SourceID {
  if (tile.kind === 'recipe' && tile.resource) return `connector:${tile.resource.connectorID}`
  if (tile.kind !== 'browser') return sources.find(s => s.kinds.some(kind => kind === tile.kind))?.id || 'web'
  try {
    const host = new URL(tile.url!).hostname
    const provider = sources.find(s => s.hosts.some(domain => host === domain || host.endsWith(`.${domain}`)))
    if (provider) return provider.id
  } catch { /* Invalid browser addresses have no provider identity. */ }
  return 'web'
}
export function resourceAction(tile: TileInput) {
  if (tile.kind === 'recipe') return `${tile.sourceName || tile.resource?.connectorID || 'Connector'} · ${tile.resource?.resourceID ? 'Resource · Open detail' : 'Collection · Browse items'}`
  const source = sources.find(s => s.id === resourceSource(tile))!.name
  const actions = { folder: 'Folder · Browse files', file: 'File · Read text', projects: 'Projects · Browse projects', project: 'Project · Show sessions', session: 'Session · Open conversation', review: 'Changes · Review diff', details: 'Session · Show details', 'front-list': 'Inbox · Read conversations', 'front-conversation': 'Conversation · Read messages', browser: 'Web page · Open browser' }
  return `${source} · ${actions[tile.kind]}`
}
export function launcherIntent(value: string, selected?: SourceID) {
  let query = value.trim(), source = selected
  const prefix = query.match(/^(opencode|files|front|mail|slack|dm|github|pr|web)(?:\s+|:\s*)(.*)$/i)
  if (prefix) {
    const aliases: Record<string, SourceID> = { mail: 'front', dm: 'slack', pr: 'github' }
    source = aliases[prefix[1].toLowerCase()] || prefix[1].toLowerCase() as SourceID
    query = prefix[2]
  }
  const start = query.match(/^(?:start|new|create)(?: an?)? (?:opencode )?session(?: in| for)?\s*(.*)$/i)
  if (start) return { source: 'opencode' as const, query: start[1], create: true }
  const browse = query.match(/^(?:browse|show|open)(?: the)? (.+?) files\.?$/i) || query.match(/^(?:browse files(?: in)?|browse folder|browse)\s+(.+)$/i)
  if (browse) { source = 'files'; query = browse[1] }
  const sessions = query.match(/^(?:open|show)(?: the)? (.+?) sessions(?: in opencode)?\.?$/i)
  if (sessions) { source = 'opencode'; query = sessions[1] }
  query = query.replace(/^(open|find|go to)\s+/i, '')
  return { source, query, create: false }
}

/** Short commands can resemble resource titles (e.g. an OpenCode session
 * named "PR cleanup"). They request discovery, not a mandatory source filter. */
export function launcherScope(value: string, selected?: SourceID): SourceID | undefined {
  const intent = launcherIntent(value, selected)
  return !selected && /^(dm|pr)(?:\s|:)/i.test(value.trim()) && !intent.create ? undefined : intent.source
}
