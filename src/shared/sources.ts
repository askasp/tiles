import type { TileInput } from './tiles'
import { catalogue } from './registry'
export type { CatalogueEntry } from './catalogue'

export const sources = catalogue
export const builtinSources = catalogue.filter(s => s.builtin).map(s => s.id)
export type SourceID = string

/** “add front”, “connect github”, “set up linear” → the requested service (`known` when a source handles it). */
export function addIntent(value: string): { name: string; known?: string } | undefined {
  const match = value.trim().match(/^(?:add|connect|set ?up|install)(?:\s+(?:a|an|the|my))?\s+(.+?)(?:\s+(?:source|account|connector))?\.?$/i)
  if (!match || /^(?:a\s+)?model$/i.test(match[1])) return undefined
  const name = match[1].trim(), compact = name.toLowerCase().replace(/[^a-z]/g, '')
  const known = catalogue.find(s => !s.builtin && (s.id === compact || s.name.toLowerCase().replace(/[^a-z]/g, '') === compact || s.hosts.some(h => h.split('.')[0] === compact)))
  return { name, known: known?.id }
}
export const modelIntent = (value: string) => /^(?:model|ai model|connect (?:a |the )?model|change (?:the )?model|set ?up (?:a |the )?model)$/i.test(value.trim())
export const terminalIntent = (value: string) => value.trim().match(/^(?:terminal|shell|term|open (?:a )?terminal|new terminal)(?:\s+(?:in|at|here)\s*(.*))?$/i)

const entryFor = (tile: TileInput) => catalogue.find(s => Object.hasOwn(s.kinds, tile.kind))
/** Source, resource and action are separate from tile ownership and layout. */
export function resourceSource(tile: TileInput): SourceID {
  if (tile.kind === 'recipe' && tile.resource) return `connector:${tile.resource.connectorID}`
  if (tile.kind !== 'browser') return entryFor(tile)?.id || 'web'
  try {
    const host = new URL(tile.url!).hostname
    const provider = catalogue.find(s => s.hosts.some(domain => host === domain || host.endsWith(`.${domain}`)))
    if (provider) return provider.id
  } catch { /* Invalid browser addresses have no provider identity. */ }
  return 'web'
}
export function resourceAction(tile: TileInput) {
  if (tile.kind === 'recipe') return `${tile.sourceName || tile.resource?.connectorID || 'Connector'} · ${tile.resource?.resourceID ? 'Resource · Open detail' : 'Collection · Browse items'}`
  const owner = entryFor(tile), source = catalogue.find(s => s.id === resourceSource(tile))?.name || 'Browser'
  const kind = owner?.kinds[tile.kind]
  return `${source} · ${kind?.kind || tile.kind} · ${kind?.action || 'Open'}`
}
/** How a result reads in K: “Folder”, “OpenCode project”, “Front conversation”. */
export function resourceLabel(tile: TileInput) {
  if (tile.kind === 'recipe') return `${tile.sourceName || 'Connector'} ${tile.resource?.resourceID ? 'item' : 'list'}`
  return entryFor(tile)?.kinds[tile.kind]?.label || tile.kind
}
export function launcherIntent(value: string, selected?: SourceID) {
  let query = value.trim(), source = selected
  const prefix = query.match(/^([a-z]+)(?:\s+|:\s*)(.*)$/i)
  const owner = prefix && catalogue.find(s => s.prefixes.includes(prefix[1].toLowerCase()))
  if (prefix && owner) { source = owner.id; query = prefix[2] }
  const browse = query.match(/^(?:browse|show|open)(?: the)? (.+?) files\.?$/i) || query.match(/^(?:browse files(?: in)?|browse folder|browse)\s+(.+)$/i)
  if (browse) { source = 'files'; query = browse[1] }
  query = query.replace(/^(open|find|go to)\s+/i, '')
  return { source, query }
}

/** Short commands can resemble resource titles (e.g. a session named "PR cleanup").
 * They request discovery, not a mandatory source filter. */
export function launcherScope(value: string, selected?: SourceID): SourceID | undefined {
  const intent = launcherIntent(value, selected)
  return !selected && /^(dm|pr)(?:\s|:)/i.test(value.trim()) ? undefined : intent.source
}
