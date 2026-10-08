import type { ConnectorDefinition, ConnectorFilter, RecipePage, ResourceRef, TileRecipe } from '../../shared/connectors'

/** What a code connector may do: read JSON from its own API with the stored credential. */
export interface CodeContext {
  settings: Record<string, string>
  /** GET a path under the connector's base URL. Cached for `ttl` ms when given. */
  get(path: string, query?: Record<string, string>, ttl?: number): Promise<Record<string, unknown>>
}
/**
 * A service that ships with ChatOS. It is an ordinary connector definition — the same tiles,
 * setup, token storage, write confirmation and search as any connector K builds — plus code
 * only where a mapping can't reach (search paths, joins, HTML mail). Every hook is optional:
 * without one, the declarative mapping runs.
 */
export interface CodeConnector {
  definition: ConnectorDefinition
  hint: string
  /** Non-secret values the user may fill in, e.g. a teammate ID for personal filters. */
  settings?: { key: string; label: string; placeholder?: string; check?: (value: string) => string | undefined }[]
  filters?(settings: Record<string, string>): ConnectorFilter[]
  /** Who the token belongs to. Throws when the token doesn't work. */
  validate?(context: CodeContext): Promise<string>
  /** Reads a page in code. */
  read?(recipe: TileRecipe, ref: ResourceRef, cursor: string | undefined, context: CodeContext): Promise<Omit<RecipePage, 'recipe'>>
  /** Adds fields to a write's JSON body. The confirmation shows the result exactly. */
  body?(operationID: string, body: Record<string, string>, settings: Record<string, string>): Record<string, string>
}

export const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export const records = (v: unknown, max = 100) => Array.isArray(v) ? v.slice(0, max).map(record) : []
export const text = (v: unknown, max = 300) => typeof v === 'string' ? v.slice(0, max) : ''
/** An https URL on one of `hosts` (or their subdomains), else undefined. */
export function webURL(value: unknown, hosts: string[]): string | undefined {
  try {
    const url = new URL(text(value, 2000))
    if (url.protocol !== 'https:' || url.username || url.password || !hosts.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) return
    return url.href
  } catch { return }
}
