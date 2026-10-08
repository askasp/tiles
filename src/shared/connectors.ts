/** Declarative data only: no scripts, HTML, dynamic hosts or arbitrary headers. */
export interface ConnectorOperation {
  id: string
  label: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  effect: 'read' | 'write'
  path: string
  query?: Record<string, string>
  body?: Record<string, string>
  pagination?: 'cursor' | 'next-url'
}
export interface TileRecipe {
  id: string
  label: string
  shape: 'collection' | 'item'
  view: 'list' | 'table' | 'timeline' | 'record' | 'document' | 'conversation' | 'diff'
  operation: string
  searchOperation?: string
  /** Collection rows open this recipe in a separate, globally unique tile. */
  itemRecipe?: string
  /** Item recipes sharing an identity are alternate presentations, not copies. */
  identity?: string
  identityScope?: 'global' | 'parent'
  parentField?: string
  items?: string
  idField: string
  titleField: string
  subtitleField?: string
  textField?: string
  messages?: string
  messageTextField?: string
  messageKindField?: string
  messageKinds?: Record<string, 'message' | 'note' | 'tool-call' | 'event'>
  messageAuthorField?: string
  messageTimeField?: string
  timeField?: string
  nextField?: string
  /** Rows open this web address in a Browser tile instead of an item recipe. */
  urlField?: string
  fields?: { label: string; path: string; kind?: 'text' | 'number' | 'date' | 'badge' }[]
  actions?: { label: string; operation: string }[]
}
export interface ConnectorDefinition {
  version: 1
  id: string
  name: string
  baseURL: string
  auth: { type: 'none' | 'bearer' | 'oauth-required' | 'oauth2'; help?: string; oauth?: OAuthConfiguration }
  operations: ConnectorOperation[]
  recipes: TileRecipe[]
}
/** Registered native/public OAuth client. Authorization Code + PKCE only. */
export interface OAuthConfiguration {
  clientID: string
  authorizationURL: string
  tokenURL: string
  scopes: string[]
  callbackPort?: number
  offline?: boolean
}
/** A value a built-in connector asks you for, e.g. your Front teammate ID. Never a secret. */
export interface ConnectorSetting { key: string; label: string; placeholder?: string; value: string }
/** A saved filter: a collection opened with a query, e.g. “Assigned to me”. */
export interface ConnectorFilter { title: string; recipeID: string; query: string; ready: boolean }
export interface ConnectorInfo {
  definition: ConnectorDefinition
  /** Ships with ChatOS: code fills in what a mapping can't express; the mapping itself is fixed. */
  builtin?: boolean
  /** Who the token belongs to, once checked. */
  account?: string
  settings?: ConnectorSetting[]
  filters?: ConnectorFilter[]
  /** Searched only when K is narrowed to it (its prefix or Tab), never on every keystroke. */
  scopedSearch?: boolean
  revision: number
  hasToken: boolean
  tokenStorage: 'encrypted' | 'session' | 'none'
}
export interface ResourceRef { connectorID: string; recipeID: string; resourceID?: string; parentID?: string; query?: string }
export interface RecipeItem { id: string; title: string; subtitle: string; text: string; parentID?: string; time?: string; url?: string; fields: { label: string; value: string; kind?: 'text' | 'number' | 'date' | 'badge' }[] }
export interface RecipeMessage { kind: 'message' | 'note' | 'tool-call' | 'event'; text: string; author: string; time: string }
export interface RecipePage { recipe: TileRecipe; items: RecipeItem[]; messages: RecipeMessage[]; next?: string }
export interface ConnectorSearch { resources: { ref: ResourceRef; title: string; description: string; url?: string }[]; errors: string[] }

const identifier = /^[a-z][a-z0-9-]{0,63}$/
const fieldPath = /^(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)?$/
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
export function valueAt(data: unknown, path = ''): unknown {
  let value = data
  for (const segment of path ? path.split('.') : []) {
    if (forbidden.has(segment) || !value || typeof value !== 'object' || !Object.hasOwn(value, segment)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}
export function displayValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return (typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)).slice(0, 60_000)
}
function object(value: unknown, keys: string[], where = 'value'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be a JSON object, got ${Array.isArray(value) ? 'an array' : JSON.stringify(value)?.slice(0, 60) ?? 'nothing'}`)
  const result = value as Record<string, unknown>
  const extra = Object.keys(result).filter(key => !keys.includes(key))
  if (extra.length) throw new Error(`${where} has unsupported field “${extra[0]}” (allowed: ${keys.join(', ')}); scripts, headers and credentials are not allowed`)
  return result
}
function text(value: unknown, max = 300): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('Invalid or oversized text')
  return value
}
function id(value: unknown): string { const s = text(value, 64); if (!identifier.test(s)) throw new Error('Use lowercase identifiers, e.g. customer-inbox'); return s }
function path(value: unknown): string { const s = text(value, 200); if (!fieldPath.test(s) || s.split('.').some(k => forbidden.has(k))) throw new Error('Use simple dotted JSON field paths'); return s }
function template(value: unknown): string {
  const s = text(value, 2000)
  if (/[{}]/.test(s.replace(/\{(id|parent|query|cursor|draft)\}/g, ''))) throw new Error('Supported placeholders: {id}, {parent}, {query}, {cursor}, {draft}')
  return s
}
/** Keys that carry credentials. Pagination tokens (page_token, pageToken, next_token…) are not. */
const credentialKey = (key: string) => /secret|password|authorization|api.?key/i.test(key) || (/token/i.test(key) && !/^(page|next|continuation|sync|cursor)_?token$/i.test(key))
function mappings(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 30) throw new Error('Invalid parameter mappings')
  return Object.fromEntries(Object.entries(value).map(([key, val]) => { if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || forbidden.has(key) || credentialKey(key)) throw new Error(`query/body key ${JSON.stringify(key)} looks like a credential; authentication belongs in auth, never in mappings`); return [key, template(val)] }))
}
export function connectorBaseURL(value: unknown): string {
  const url = new URL(text(value, 2000))
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) throw new Error('Use HTTPS (HTTP allowed only on localhost), without credentials or query parameters')
  return url.href.replace(/\/$/, '')
}
/** Rules every proposal must follow, stated for models (the validator enforces them). */
export const connectorRules = `Rules (the validator rejects anything else):
- Top level: {version:1,id,name,baseURL,auth,operations,recipes}. id is lowercase letters, digits and dashes.
- auth.type is "none", "bearer" (token pasted later), "oauth-required" or "oauth2". Never put keys or tokens in paths, query or body.
- operations: {id,label,method,effect,path,query?,body?,pagination?}. GET ⇔ effect "read"; other methods are effect "write". path starts with "/" and may use {id} or {parent} only.
- query/body: objects of string templates; placeholders {query} {cursor} {draft}.
- recipes: {id,label,shape,view,operation,idField,titleField,...}. shape "collection" uses view list|table|timeline and MUST set itemRecipe to the id of an item recipe; shape "item" uses view record|document|conversation|diff.
- items: dotted path to the array in the response; "" when the response itself is the array.
- Field paths are dotted names like "user.name" (no "$", brackets or expressions). fields: [{label,path,kind?}] with kind text|number|date|badge.
- A collection whose rows are web pages may set urlField (dotted path to an https URL) instead of itemRecipe.
- Keep it small: one or two collections with their item recipes, read-only unless asked for writes.`

/** Models often use near-miss names (`items: "."`, `view: "detail"`). Map the harmless ones
 * before validation; everything else still has to validate exactly. */
export function normalizeConnectorDraft(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const d = structuredClone(value) as Record<string, unknown>
  const views: Record<string, string> = { detail: 'record', details: 'record', item: 'record', object: 'record', grid: 'table', chat: 'conversation', thread: 'conversation', messages: 'conversation', markdown: 'document', text: 'document', feed: 'timeline', cards: 'list' }
  if (Array.isArray(d.recipes)) d.recipes = d.recipes.map(raw => {
    if (!raw || typeof raw !== 'object') return raw
    const r = { ...(raw as Record<string, unknown>) }
    if (typeof r.items === 'string' && ['.', '$', '/', '[]', '$[*]'].includes(r.items.trim())) r.items = ''
    if (typeof r.view === 'string' && views[r.view.toLowerCase()]) r.view = views[r.view.toLowerCase()]
    for (const key of ['idField', 'titleField', 'subtitleField', 'textField', 'items', 'messages', 'timeField', 'nextField']) if (typeof r[key] === 'string') r[key] = (r[key] as string).replace(/^\$\.?/, '').replace(/^\./, '')
    if (Array.isArray(r.fields)) r.fields = r.fields.map(f => f && typeof f === 'object' && typeof (f as { path?: unknown }).path === 'string' ? { ...f, path: (f as { path: string }).path.replace(/^\$\.?/, '') } : f)
    return r
  })
  if (Array.isArray(d.operations)) d.operations = d.operations.map(raw => raw && typeof raw === 'object' && typeof (raw as { method?: unknown }).method === 'string' ? { ...raw, method: (raw as { method: string }).method.toUpperCase() } : raw)
  return d
}
/** `builtin` is only for definitions shipped with ChatOS, which may use the reserved identifiers. */
export function validateConnector(value: unknown, builtin = false): ConnectorDefinition {
  if (JSON.stringify(value).length > 100_000) throw new Error('Keep connector definitions under 100 KB')
  const d = object(value, ['version', 'id', 'name', 'baseURL', 'auth', 'operations', 'recipes'], 'connector')
  if (d.version !== 1) throw new Error('Unsupported connector version')
  const connectorID = id(d.id)
  if (!builtin && ['opencode', 'front', 'slack', 'github', 'files', 'web', 'terminal'].includes(connectorID)) throw new Error('This identifier belongs to a built-in source; choose a custom connector identifier')
  const a = object(d.auth, ['type', 'help', 'oauth'], 'auth')
  if (!['none', 'bearer', 'oauth-required', 'oauth2'].includes(String(a.type))) throw new Error('Unsupported authentication type')
  let oauth: OAuthConfiguration | undefined
  if (a.type === 'oauth2') {
    const config = object(a.oauth, ['clientID', 'authorizationURL', 'tokenURL', 'scopes', 'callbackPort', 'offline'], 'auth.oauth')
    if (!Array.isArray(config.scopes) || config.scopes.length > 30 || !config.scopes.length || config.scopes.some(scope => typeof scope !== 'string' || !scope || /\s/.test(scope))) throw new Error('OAuth needs 1–30 explicit scopes')
    if (config.callbackPort !== undefined && (!Number.isSafeInteger(config.callbackPort) || Number(config.callbackPort) < 1024 || Number(config.callbackPort) > 65535)) throw new Error('OAuth callbackPort must be 1024–65535, or omitted for a dynamic loopback port')
    if (config.offline !== undefined && typeof config.offline !== 'boolean') throw new Error('offline must be boolean')
    oauth = { clientID: text(config.clientID, 1000), authorizationURL: connectorBaseURL(config.authorizationURL), tokenURL: connectorBaseURL(config.tokenURL), scopes: config.scopes.map(scope => text(scope, 500)), ...(config.callbackPort !== undefined && { callbackPort: Number(config.callbackPort) }), ...(config.offline !== undefined && { offline: config.offline as boolean }) }
    if (!oauth.clientID) throw new Error('Supply a registered native OAuth client ID')
  } else if (a.oauth !== undefined) throw new Error('OAuth configuration belongs to auth.type oauth2')
  if (!Array.isArray(d.operations) || !d.operations.length || d.operations.length > 30 || !Array.isArray(d.recipes) || !d.recipes.length || d.recipes.length > 30) throw new Error('Provide 1–30 operations and recipes')
  const at = <T,>(where: string, run: () => T): T => { try { return run() } catch (e) { const message = e instanceof Error ? e.message : String(e); throw new Error(message.startsWith(where) ? message : `${where}: ${message}`) } }
  const operations: ConnectorOperation[] = d.operations.map(raw => at(`operation ${JSON.stringify((raw as { id?: unknown })?.id ?? '?')}`, () => {
    const op = object(raw, ['id', 'label', 'method', 'effect', 'path', 'query', 'body', 'pagination'], `operation ${JSON.stringify((raw as { id?: unknown })?.id ?? '?')}`)
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(op.method)) || !['read', 'write'].includes(String(op.effect)) || (op.method === 'GET') !== (op.effect === 'read')) throw new Error('Only GET is read-only; all other methods require write confirmation')
    const p = template(op.path)
    if (!p.startsWith('/') || p.startsWith('//') || /[?#\\]/.test(p) || p.split('/').some(s => s === '.' || s === '..') || /%|\{(?:query|cursor|draft)\}/.test(p)) throw new Error('Use a fixed relative API path, with optional {id} or {parent}')
    if (op.method === 'GET' && op.body !== undefined) throw new Error('GET cannot have a body')
    if (op.pagination !== undefined && (op.method !== 'GET' || !['cursor', 'next-url'].includes(String(op.pagination)))) throw new Error('GET pagination is cursor or next-url')
    return { id: id(op.id), label: text(op.label), method: op.method as ConnectorOperation['method'], effect: op.effect as ConnectorOperation['effect'], path: p, ...(op.query !== undefined && { query: mappings(op.query) }), ...(op.body !== undefined && { body: mappings(op.body) }), ...(op.pagination !== undefined && { pagination: op.pagination as ConnectorOperation['pagination'] }) }
  }))
  const opIDs = new Set(operations.map(op => op.id))
  if (opIDs.size !== operations.length) throw new Error('Duplicate operation identifier')
  const read = (value: unknown) => { const key = id(value); if (!operations.some(op => op.id === key && op.effect === 'read')) throw new Error(`operation ${JSON.stringify(key)} must be a GET operation defined in operations`); return key }
  const recipes: TileRecipe[] = d.recipes.map(raw => at(`recipe ${JSON.stringify((raw as { id?: unknown })?.id ?? '?')}`, () => {
    const r = object(raw, ['id', 'label', 'shape', 'view', 'operation', 'searchOperation', 'itemRecipe', 'identity', 'identityScope', 'parentField', 'items', 'idField', 'titleField', 'subtitleField', 'textField', 'messages', 'messageTextField', 'messageKindField', 'messageKinds', 'messageAuthorField', 'messageTimeField', 'timeField', 'nextField', 'urlField', 'fields', 'actions'], `recipe ${JSON.stringify((raw as { id?: unknown })?.id ?? '?')}`)
    if (!['collection', 'item'].includes(String(r.shape)) || !['list', 'table', 'timeline', 'record', 'document', 'conversation', 'diff'].includes(String(r.view)) || (r.shape === 'collection') !== ['list', 'table', 'timeline'].includes(String(r.view))) throw new Error('collections use view list/table/timeline; items use record/document/conversation/diff')
    const result: TileRecipe = { id: id(r.id), label: text(r.label), shape: r.shape as TileRecipe['shape'], view: r.view as TileRecipe['view'], operation: read(r.operation), idField: path(r.idField), titleField: path(r.titleField) }
    for (const key of ['items', 'parentField', 'subtitleField', 'textField', 'messages', 'messageTextField', 'messageKindField', 'messageAuthorField', 'messageTimeField', 'timeField', 'nextField', 'urlField'] as const) if (r[key] !== undefined) result[key] = path(r[key])
    if (r.messageKinds !== undefined) {
      if (!r.messageKinds || typeof r.messageKinds !== 'object' || Array.isArray(r.messageKinds) || Object.keys(r.messageKinds).length > 30) throw new Error('Invalid message kind mapping')
      result.messageKinds = Object.fromEntries(Object.entries(r.messageKinds).map(([key, value]) => { if (forbidden.has(key) || key.length > 100 || !['message', 'note', 'tool-call', 'event'].includes(String(value))) throw new Error('Message kinds: message, note, tool-call, event'); return [key, value] })) as TileRecipe['messageKinds']
    }
    if (r.searchOperation !== undefined) result.searchOperation = read(r.searchOperation)
    if (r.identity !== undefined) result.identity = id(r.identity)
    if (r.identityScope !== undefined) { if (!['global', 'parent'].includes(String(r.identityScope))) throw new Error('Identity scope must be global or parent'); result.identityScope = r.identityScope as TileRecipe['identityScope'] }
    if (r.itemRecipe !== undefined) result.itemRecipe = id(r.itemRecipe)
    if (r.fields !== undefined) {
      if (!Array.isArray(r.fields) || r.fields.length > 30) throw new Error('Too many fields')
      result.fields = r.fields.map(v => { const f = object(v, ['label', 'path', 'kind'], `recipe ${JSON.stringify(r.id)} field`); if (f.kind !== undefined && !['text', 'number', 'date', 'badge'].includes(String(f.kind))) throw new Error('Field kinds: text, number, date, badge'); return { label: text(f.label), path: path(f.path), ...(f.kind !== undefined && { kind: f.kind as 'text' | 'number' | 'date' | 'badge' }) } })
    }
    if (r.actions !== undefined) {
      if (!Array.isArray(r.actions) || r.actions.length > 15) throw new Error('Too many actions')
      result.actions = r.actions.map(v => { const action = object(v, ['label', 'operation'], `recipe ${JSON.stringify(r.id)} action`); const key = id(action.operation); if (!opIDs.has(key)) throw new Error('Unknown action operation'); return { label: text(action.label), operation: key } })
    }
    return result
  }))
  if (new Set(recipes.map(r => r.id)).size !== recipes.length) throw new Error('Duplicate recipe identifier')
  for (const recipe of recipes) {
    if (recipe.shape === 'collection' && !(recipe.urlField && !recipe.itemRecipe) && (!recipe.itemRecipe || !recipes.some(r => r.id === recipe.itemRecipe))) throw new Error(`recipe ${JSON.stringify(recipe.id)}: every collection needs "itemRecipe" naming the item recipe its rows open (one of: ${recipes.filter(r => r.shape === 'item').map(r => r.id).join(', ') || 'none defined yet'})`)
    if (recipe.shape === 'item' && recipe.itemRecipe) throw new Error(`recipe ${JSON.stringify(recipe.id)}: only collections open row recipes`)
  }
  return { version: 1, id: connectorID, name: text(d.name), baseURL: connectorBaseURL(d.baseURL), auth: { type: a.type as ConnectorDefinition['auth']['type'], ...(a.help !== undefined && { help: text(a.help, 2000) }), ...(oauth && { oauth }) }, operations, recipes }
}
export function validateRef(value: unknown): ResourceRef {
  const r = object(value, ['connectorID', 'recipeID', 'resourceID', 'parentID', 'query'])
  return { connectorID: id(r.connectorID), recipeID: id(r.recipeID), ...(r.resourceID !== undefined && { resourceID: text(r.resourceID, 500) }), ...(r.parentID !== undefined && { parentID: text(r.parentID, 500) }), ...(r.query !== undefined && { query: text(r.query, 300).trim() }) }
}
export function resourceKey(ref: ResourceRef, recipe?: Pick<TileRecipe, 'shape' | 'identity' | 'identityScope'>): string {
  const r = validateRef(ref)
  if (recipe?.identityScope === 'parent' && !r.parentID) throw new Error('This resource identity needs its parent (e.g. Slack channel)')
  return `connector:${r.connectorID}:${recipe?.identity || r.recipeID}:${r.resourceID !== undefined ? `item:${recipe?.identityScope === 'parent' ? `${encodeURIComponent(r.parentID!)}:` : ''}${encodeURIComponent(r.resourceID)}` : `list:${encodeURIComponent(r.parentID || '')}:${encodeURIComponent(r.query || '')}`}`
}
export const exampleConnector: ConnectorDefinition = {
  version: 1, id: 'helpdesk', name: 'Helpdesk', baseURL: 'https://api.example.com', auth: { type: 'bearer', help: 'Create a read-only API token in your service settings.' },
  operations: [
    { id: 'tickets', label: 'List tickets', method: 'GET', effect: 'read', path: '/tickets', query: { search: '{query}', cursor: '{cursor}' } },
    { id: 'ticket', label: 'Read ticket', method: 'GET', effect: 'read', path: '/tickets/{id}' },
  ],
  recipes: [
    { id: 'inbox', label: 'Ticket inbox', shape: 'collection', view: 'list', operation: 'tickets', searchOperation: 'tickets', items: 'data', idField: 'id', titleField: 'subject', subtitleField: 'status', nextField: 'next', itemRecipe: 'ticket' },
    { id: 'ticket', label: 'Ticket', shape: 'item', view: 'conversation', operation: 'ticket', idField: 'id', titleField: 'subject', messages: 'messages', messageTextField: 'body', messageKindField: 'type', messageKinds: { reply: 'message', comment: 'note', tool: 'tool-call', activity: 'event' }, messageAuthorField: 'author', messageTimeField: 'created_at', fields: [{ label: 'Status', path: 'status', kind: 'badge' }] },
  ],
}
