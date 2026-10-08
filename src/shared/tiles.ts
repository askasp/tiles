import type { ContextItem, SessionInfo } from './types'
import { basename, normalizeURL, restoreState, sessionTitle, uid } from './workspaces'
import { frontConversationID, frontURL } from './front'
import { resourceKey, validateRef, type ResourceRef, type TileRecipe } from './connectors'

export type TileKind = 'session' | 'projects' | 'project' | 'recipe' | 'browser' | 'review' | 'details' | 'front-list' | 'front-conversation' | 'folder' | 'file' | 'terminal'
const tileKinds: TileKind[] = ['session', 'projects', 'project', 'recipe', 'browser', 'review', 'details', 'front-list', 'front-conversation', 'folder', 'file', 'terminal']
export type OpenMode = 'here' | 'new' | 'move'
export type Direction = 'left' | 'right' | 'up' | 'down'
export interface Tile {
  id: string
  key: string
  kind: TileKind
  title: string
  label?: string
  directory?: string
  sessionID?: string
  url?: string
  linkID?: string
  frontQuery?: string
  conversationID?: string
  path?: string
  resource?: ResourceRef
  recipeIdentity?: string
  recipeIdentityScope?: 'global' | 'parent'
  sourceName?: string
  workspaceID: string | null
  status: 'visible' | 'shelf' | 'closed'
  lastWorkspaceID?: string
  lastUsed: number
  shelvedAt: number
  draft: string
  context: ContextItem[]
}
export interface TileWorkspace {
  id: string
  slot: number
  title: string
  tileIDs: string[]
  focusedID: string | null
  fullscreenID: string | null
}
interface Arrangement {
  activeID: string
  workspaces: TileWorkspace[]
  placements: Pick<Tile, 'id' | 'workspaceID' | 'lastWorkspaceID' | 'status' | 'lastUsed' | 'shelvedAt'>[]
}
export interface TileDesktop {
  version: 2
  activeID: string
  workspaces: TileWorkspace[]
  tiles: Tile[]
  clock: number
  folders: string[]
  selectedDirectory: string
  pinned: string[]
  homeDraft: string
  history: Arrangement[]
}
export type TileInput = Pick<Tile, 'key' | 'kind' | 'title'> & Partial<Pick<Tile, 'id' | 'directory' | 'sessionID' | 'url' | 'linkID' | 'draft' | 'context' | 'label' | 'frontQuery' | 'conversationID' | 'path' | 'resource' | 'recipeIdentity' | 'recipeIdentityScope' | 'sourceName'>>
export const desktopInitial = (directory = ''): TileDesktop => ({ version: 2, activeID: 'home', workspaces: [], tiles: [], clock: 0, folders: [], selectedDirectory: directory, pinned: [], homeDraft: '', history: [] })
export const sessionTile = (s: SessionInfo): TileInput => ({ id: s.id, key: `session:${s.id}`, kind: 'session', title: sessionTitle(s), sessionID: s.id, directory: s.location.directory || '' })
export const projectTile = (directory: string, title = basename(directory)): TileInput => ({ key: `project:${directory}`, kind: 'project', title, directory })
export const projectsTile = (): TileInput => ({ key: 'opencode:projects', kind: 'projects', title: 'OpenCode projects' })
export const recipeTile = (ref: ResourceRef, title: string, recipe?: Pick<TileRecipe, 'shape' | 'identity' | 'identityScope'>, sourceName?: string): TileInput => ({ key: resourceKey(ref, recipe), kind: 'recipe', title, resource: validateRef(ref), recipeIdentity: recipe?.identity, recipeIdentityScope: recipe?.identityScope, sourceName })
export const fileTile = (path: string, kind: 'folder' | 'file' = 'folder', title = basename(path)): TileInput => {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0')) throw new Error('Use an absolute local path')
  // Real paths are resolved in the main process before opening a Files tile.
  return { key: `${kind}:${path}`, kind, title: title || '/', path, ...(kind === 'folder' && { directory: path }) }
}
/** Every terminal is its own resource: a shell started in a folder. */
export const terminalTile = (directory: string, id: string = uid()): TileInput => {
  if (typeof directory !== 'string' || !directory.startsWith('/') || directory.includes('\0')) throw new Error('Use an absolute local folder')
  return { id, key: `terminal:${id}`, kind: 'terminal', title: 'Terminal', directory, path: directory }
}
export const browserTile = (url: string, linkID?: string): TileInput => {
  const normalized = normalizeURL(url)
  const id = frontConversationID(normalized)
  return { key: id ? `front:${id}` : `browser:${normalized}`, kind: 'browser', title: new URL(normalized).hostname, url: normalized, linkID }
}
export const frontInboxTile = (query = 'is:open', title?: string): TileInput => {
  const clean = query.trim()
  if (clean.length > 300) throw new Error('Keep Front filters under 300 characters')
  return { key: `front-list:${clean}`, kind: 'front-list', title: title || `Front · ${clean || 'All conversations'}`, frontQuery: clean }
}
export const frontConversationTile = (id: string, title = 'Front conversation'): TileInput => ({ key: `front:${id}`, kind: 'front-conversation', title, conversationID: id, url: frontURL(id) })
export const activeWorkspace = (s: TileDesktop) => s.workspaces.find(w => w.id === s.activeID)
export const focusedTile = (s: TileDesktop) => s.tiles.find(t => t.id === activeWorkspace(s)?.focusedID)
export const shelfTiles = (s: TileDesktop) => s.tiles.filter(t => t.status === 'shelf').sort((a, b) => b.shelvedAt - a.shelvedAt)
export const tileTitle = (t: Pick<Tile, 'title' | 'label'>) => t.label || t.title

function checkpoint(s: TileDesktop): TileDesktop {
  return { ...s, history: [...s.history.slice(-24), {
    activeID: s.activeID,
    workspaces: s.workspaces.map(w => ({ ...w, tileIDs: [...w.tileIDs] })),
    placements: s.tiles.map(({ id, workspaceID, lastWorkspaceID, status, lastUsed, shelvedAt }) => ({ id, workspaceID, lastWorkspaceID, status, lastUsed, shelvedAt })),
  }] }
}
function workspace(s: TileDesktop, slot?: number): [TileDesktop, string] {
  if (slot !== undefined) {
    const existing = s.workspaces.find(w => w.slot === slot)
    if (existing) return [s, existing.id]
  }
  const number = slot ?? Array.from({ length: s.workspaces.length + 1 }, (_, i) => i + 1).find(n => !s.workspaces.some(w => w.slot === n))!
  const id = `workspace:${number}`
  return [{ ...s, workspaces: [...s.workspaces, { id, slot: number, title: 'Workspace', tileIDs: [], focusedID: null, fullscreenID: null }].sort((a, b) => a.slot - b.slot) }, id]
}
function tidy(s: TileDesktop): TileDesktop {
  const workspaces = s.workspaces.map(w => {
    const ids = w.tileIDs.filter(id => s.tiles.some(t => t.id === id && t.status === 'visible' && t.workspaceID === w.id))
    const titleTile = ids.map(id => s.tiles.find(t => t.id === id)!).find(t => t.directory) || s.tiles.find(t => t.id === ids[0])
    return { ...w, tileIDs: ids, title: titleTile?.directory ? basename(titleTile.directory) : titleTile?.title || 'Workspace', focusedID: ids.includes(w.focusedID || '') ? w.focusedID : ids[0] || null, fullscreenID: ids.includes(w.fullscreenID || '') ? w.fullscreenID : null }
  }).filter(w => w.tileIDs.length || w.id === s.activeID)
  return { ...s, workspaces }
}
function place(s: TileDesktop, ids: string[], target: string, focus: string): TileDesktop {
  const tick = s.clock + 1
  let tiles = s.tiles.map(t => ids.includes(t.id) ? { ...t, status: 'visible' as const, workspaceID: target, lastWorkspaceID: target, lastUsed: tick } : t)
  let workspaces = s.workspaces.map(w => ({ ...w, tileIDs: w.tileIDs.filter(id => !ids.includes(id)) }))
  workspaces = workspaces.map(w => w.id === target ? { ...w, tileIDs: [...w.tileIDs, ...ids], focusedID: focus, fullscreenID: null } : w)
  let owner = workspaces.find(w => w.id === target)!
  while (owner.tileIDs.length > 4) {
    // Never evict the resource explicitly requested. Prefer untouched old tiles.
    const focused = tiles.find(t => t.id === focus)!
    const candidates = owner.tileIDs.filter(id => id !== focus).map(id => tiles.find(t => t.id === id)!)
    const oldest = candidates.sort((a, b) => a.lastUsed - b.lastUsed)[0]
    // Automatic shelving is hiding too: carry a session's linked previews.
    // If that would hide the explicitly requested preview, protect its parent
    // and evict a different resource (or an older sibling in an oversized group).
    const victim = oldest.id === focused.linkID ? candidates.find(t => t.id !== focused.linkID) || oldest : oldest
    const evicted = new Set([victim.id, ...tiles.filter(t => t.linkID === victim.id && t.id !== focus && t.workspaceID === target).map(t => t.id)])
    tiles = tiles.map(t => evicted.has(t.id) ? { ...t, status: 'shelf' as const, workspaceID: null, lastWorkspaceID: target, shelvedAt: tick } : t)
    owner = { ...owner, tileIDs: owner.tileIDs.filter(id => !evicted.has(id)) }
    workspaces = workspaces.map(w => w.id === target ? owner : w)
  }
  return tidy({ ...s, activeID: target, clock: tick, tiles, workspaces })
}
function linkedIDs(s: TileDesktop, id: string): string[] {
  const tile = s.tiles.find(t => t.id === id)
  if (!tile) return []
  const root = tile.id
  return s.tiles.filter(t => t.status !== 'closed' && (t.id === root || t.linkID === root)).map(t => t.id)
}
export function openTile(s: TileDesktop, input: TileInput, mode: OpenMode = 'here', targetID?: string): TileDesktop {
  if (input.kind === 'browser') input = { ...input, ...browserTile(input.url!, input.linkID), title: input.title }
  if (input.kind === 'recipe') input = { ...input, ...recipeTile(input.resource!, input.title, { shape: input.resource?.resourceID ? 'item' : 'collection', identity: input.recipeIdentity, identityScope: input.recipeIdentityScope }, input.sourceName) }
  const existing = s.tiles.find(t => t.key === input.key)
  // A Front web view and API reader are presentations of the same resource.
  // An explicit API open upgrades the existing tile in place, not a copy.
  if (input.kind === 'front-conversation' && existing?.kind === 'browser') {
    s = updateTile(s, existing.id, { kind: input.kind, conversationID: input.conversationID, url: input.url, title: input.title })
  }
  const owner = existing ? s.tiles.find(t => t.id === existing.id)! : undefined
  if (owner?.status === 'visible' && mode !== 'move') return focusTile(s, owner.id)
  let next = checkpoint(s)
  let target = targetID || (mode !== 'new' ? activeWorkspace(next)?.id : undefined)
  const linkedRoot = tileRoot(next, existing)
  if (mode === 'here' && existing?.status === 'shelf' && linkedRoot?.status === 'visible') target = linkedRoot.workspaceID || target
  if (!target || !next.workspaces.some(w => w.id === target)) [next, target] = workspace(next)
  const tile: Tile = owner || { ...input, id: input.id || uid(), workspaceID: null, status: 'closed', lastUsed: 0, shelvedAt: 0, draft: input.draft || '', context: input.context || [] }
  if (!existing) next = { ...next, tiles: [...next.tiles, tile] }
  const restoreGroup = !!existing && existing.status !== 'visible'
  const ids = mode === 'move' ? linkedIDs(next, tile.linkID || tile.id) : restoreGroup ? linkedIDs(next, tile.id) : [tile.id]
  if (existing?.status === 'closed') for (const child of next.tiles.filter(t => t.linkID === existing.id && t.status === 'closed' && t.shelvedAt === existing.shelvedAt)) ids.push(child.id)
  if (!ids.includes(tile.id)) ids.push(tile.id)
  return place(next, ids, target, tile.id)
}
export function focusTile(s: TileDesktop, id: string): TileDesktop {
  const tile = s.tiles.find(t => t.id === id)
  if (!tile) return s
  if (tile.status !== 'visible') return openTile(s, tile)
  return tidy({ ...s, clock: s.clock + 1, activeID: tile.workspaceID!, tiles: s.tiles.map(t => t.id === id ? { ...t, lastUsed: s.clock + 1 } : t), workspaces: s.workspaces.map(w => w.id === tile.workspaceID ? { ...w, focusedID: id, fullscreenID: w.fullscreenID ? id : null } : w) })
}
function tileRoot(s: TileDesktop, tile?: Tile) {
  return tile?.linkID ? s.tiles.find(t => t.id === tile.linkID) : undefined
}
export function goWorkspace(s: TileDesktop, slot: number): TileDesktop {
  if (!slot) return tidy({ ...s, activeID: 'home' })
  const [next, id] = workspace(s, slot)
  return tidy({ ...next, activeID: id })
}
export function moveTile(s: TileDesktop, id: string, slot: number): TileDesktop {
  const tile = s.tiles.find(t => t.id === id)
  if (!tile || !Number.isSafeInteger(slot) || slot < 1) return s
  let next = checkpoint(s)
  const result = workspace(next, slot); next = result[0]
  const group = linkedIDs(next, tile.linkID || id)
  return place(next, group.length ? group : [id], result[1], id)
}
export function shelfTile(s: TileDesktop, id: string, close = false): TileDesktop {
  const ids = linkedIDs(s, id)
  if (!ids.length) return s
  const next = checkpoint(s)
  return tidy({ ...next, clock: s.clock + 1, tiles: next.tiles.map(t => ids.includes(t.id) ? { ...t, status: close ? 'closed' : 'shelf', lastWorkspaceID: t.workspaceID || t.lastWorkspaceID, workspaceID: null, shelvedAt: s.clock + 1 } : t) })
}
export function restoreLast(s: TileDesktop, closed = false): TileDesktop {
  const tile = s.tiles.filter(t => t.status === (closed ? 'closed' : 'shelf')).sort((a, b) => b.shelvedAt - a.shelvedAt)[0]
  return tile ? openTile(s, tile, 'move') : s
}
export function fullscreenTile(s: TileDesktop): TileDesktop {
  const w = activeWorkspace(s)
  return w ? { ...s, workspaces: s.workspaces.map(x => x.id === w.id ? { ...x, fullscreenID: x.fullscreenID ? null : x.focusedID } : x) } : s
}
export function promoteTile(s: TileDesktop): TileDesktop {
  const w = activeWorkspace(s)
  if (!w?.focusedID) return s
  const next = checkpoint(s)
  return { ...next, workspaces: next.workspaces.map(x => x.id === w.id ? {
    ...x, tileIDs: [w.focusedID!, ...x.tileIDs.filter(id => id !== w.focusedID)],
    // Four quarter-sized tiles leave no larger slot. Enlarge temporarily,
    // rather than shrinking three neighbours below the design's minimum.
    fullscreenID: w.tileIDs.length === 4 ? w.fullscreenID ? null : w.focusedID : null,
  } : x) }
}
export function tileRects(count: number): { x: number; y: number; width: number; height: number }[] {
  if (count === 1) return [{ x: 0, y: 0, width: 1, height: 1 }]
  if (count === 2) return [0, 1].map(i => ({ x: i / 2, y: 0, width: .5, height: 1 }))
  if (count === 3) return [{ x: 0, y: 0, width: .6, height: 1 }, { x: .6, y: 0, width: .4, height: .5 }, { x: .6, y: .5, width: .4, height: .5 }]
  return [0, 1, 2, 3].map(i => ({ x: i % 2 / 2, y: Math.floor(i / 2) / 2, width: .5, height: .5 }))
}
export function neighbourIndex(count: number, index: number, direction: Direction): number {
  const rects = tileRects(count), origin = rects[index]
  if (!origin) return index
  const horizontal = direction === 'left' || direction === 'right'
  const sign = direction === 'right' || direction === 'down' ? 1 : -1
  const center = (r: typeof origin) => [r.x + r.width / 2, r.y + r.height / 2]
  const [ox, oy] = center(origin)
  const candidates = rects.map((r, i) => { const [x, y] = center(r); const forward = horizontal ? (x - ox) * sign : (y - oy) * sign; return { i, forward, distance: Math.abs(horizontal ? y - oy : x - ox) * 2 + forward } }).filter(c => c.i !== index && c.forward > .01).sort((a, b) => a.distance - b.distance)
  return candidates[0]?.i ?? index
}
export function directionTile(s: TileDesktop, direction: Direction, swap = false): TileDesktop {
  const w = activeWorkspace(s)
  if (!w) return s
  const index = w.tileIDs.indexOf(w.focusedID || '')
  const to = neighbourIndex(w.tileIDs.length, index, direction)
  if (to === index || to < 0) return s
  if (!swap) return focusTile(s, w.tileIDs[to])
  const next = checkpoint(s), ids = [...w.tileIDs]; [ids[index], ids[to]] = [ids[to], ids[index]]
  return { ...next, workspaces: next.workspaces.map(x => x.id === w.id ? { ...x, tileIDs: ids } : x) }
}
export function tidyAround(s: TileDesktop, id: string): TileDesktop {
  const tile = s.tiles.find(t => t.id === id)
  if (!tile) return s
  const keep = linkedIDs(s, id)
  const owner = tile.workspaceID || s.activeID
  const next = checkpoint(s)
  return tidy({ ...next, clock: s.clock + 1, tiles: next.tiles.map(t => t.workspaceID === owner && !keep.includes(t.id) ? { ...t, status: 'shelf', workspaceID: null, lastWorkspaceID: owner, shelvedAt: s.clock + 1 } : t) })
}
export function undoArrangement(s: TileDesktop): TileDesktop {
  const previous = s.history.at(-1)
  if (!previous) return s
  return { ...s, activeID: previous.activeID, workspaces: previous.workspaces, history: s.history.slice(0, -1), tiles: s.tiles.map(t => {
    const old = previous.placements.find(x => x.id === t.id)
    return old ? { ...t, ...old } : { ...t, status: 'closed', workspaceID: null }
  }) }
}
export function updateTile(s: TileDesktop, id: string, change: Partial<Tile>): TileDesktop {
  return { ...s, tiles: s.tiles.map(t => t.id === id ? { ...t, ...change, id: t.id, workspaceID: t.workspaceID, status: t.status } : t) }
}
export function reconcileBrowser(s: TileDesktop, id: string, url: string, title: string): TileDesktop {
  const current = s.tiles.find(t => t.id === id && t.kind === 'browser')
  if (!current) return s
  const normalized = normalizeURL(url), key = browserTile(normalized).key
  const existing = s.tiles.find(t => t.id !== id && t.key === key)
  if (!existing) return updateTile(s, id, { key, url: normalized, title })
  // Redirects and client-side navigation can converge on an existing URL.
  // Forget the duplicate view, including stale undo placements; focus the owner.
  const without = {
    ...s, tiles: s.tiles.filter(t => t.id !== id),
    workspaces: s.workspaces.map(w => ({ ...w, tileIDs: w.tileIDs.filter(t => t !== id) })),
    history: s.history.map(h => ({ ...h, placements: h.placements.filter(t => t.id !== id), workspaces: h.workspaces.map(w => ({ ...w, tileIDs: w.tileIDs.filter(t => t !== id), focusedID: w.focusedID === id ? w.tileIDs.find(t => t !== id) || null : w.focusedID, fullscreenID: w.fullscreenID === id ? null : w.fullscreenID })) })),
  }
  return tidy(focusTile(without, existing.id))
}
export function serializeDesktop(s: TileDesktop): string {
  return JSON.stringify({ ...s, history: [], tiles: s.tiles.map(t => ({ ...t, context: t.context.filter(c => c.kind !== 'image') })) })
}
export function restoreDesktop(raw: string | null, directory = ''): TileDesktop {
  if (!raw) return desktopInitial(directory)
  try {
    const parsed = JSON.parse(raw)
    if (parsed.version === 1) {
      const old = restoreState(raw, directory)
      let s = { ...desktopInitial(old.selectedDirectory), folders: old.folders, pinned: old.pinned, homeDraft: old.homeDraft }
      for (const w of old.workspaces) {
        const slot = old.workspaces.indexOf(w) + 1
        s = goWorkspace(s, slot)
        const target = s.activeID
        if (w.sessionID) s = openTile(s, { id: w.sessionID, key: `session:${w.sessionID}`, kind: 'session', title: w.title, sessionID: w.sessionID, directory: w.directory, draft: w.draft, context: w.context })
        for (const tab of w.tabs) {
          s = { ...s, activeID: target }
          const input = tab.kind === 'browser' ? { ...browserTile(tab.url, w.sessionID), id: tab.id, title: tab.title } : { key: `${tab.kind}:${tab.kind === 'review' ? w.directory : w.sessionID}`, kind: tab.kind, title: tab.title, directory: w.directory, sessionID: w.sessionID, linkID: tab.kind === 'details' ? w.sessionID : undefined }
          if (!s.tiles.some(t => t.key === input.key)) s = openTile(s, input, 'here', target)
        }
        if (w.hidden) for (const t of s.tiles.filter(t => t.workspaceID === target)) s = shelfTile(s, t.id)
      }
      const oldActive = old.workspaces.find(w => w.id === old.activeID)
      const focused = s.tiles.find(t => t.sessionID === oldActive?.sessionID && t.kind === 'session')
      return tidy({ ...s, activeID: focused?.workspaceID || 'home', history: [] })
    }
    if (parsed.version !== 2 || !Array.isArray(parsed.tiles) || !Array.isArray(parsed.workspaces)) return desktopInitial(directory)
    let s: TileDesktop = { ...desktopInitial(directory), ...parsed, history: [], clock: Number.isFinite(parsed.clock) ? parsed.clock : 0 }
    const keys = new Set<string>(), ids = new Set<string>()
    s.tiles = s.tiles.filter(t => t && typeof t.id === 'string' && typeof t.key === 'string' && typeof t.title === 'string' && tileKinds.includes(t.kind) && ['visible', 'shelf', 'closed'].includes(t.status) && typeof t.draft === 'string' && Array.isArray(t.context)).filter(t => {
      if (t.kind === 'projects') t.key = 'opencode:projects'
      if (t.kind === 'recipe') { try { const input = recipeTile(t.resource!, t.title, { shape: t.resource?.resourceID ? 'item' : 'collection', identity: typeof t.recipeIdentity === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(t.recipeIdentity) ? t.recipeIdentity : undefined, identityScope: t.recipeIdentityScope === 'parent' ? 'parent' : undefined }, typeof t.sourceName === 'string' ? t.sourceName.slice(0, 300) : undefined); Object.assign(t, input) } catch { return false } }
      if (t.kind === 'session') { if (typeof t.sessionID !== 'string' || !t.sessionID) return false; t.key = `session:${t.sessionID}` }
      if (t.kind === 'project' || t.kind === 'review') { if (typeof t.directory !== 'string' || !t.directory) return false; t.key = `${t.kind}:${t.directory}` }
      if (t.kind === 'details') { if (typeof t.sessionID !== 'string' || !t.sessionID) return false; t.key = `details:${t.sessionID}` }
      if (t.kind === 'browser') { try { const input = browserTile(t.url!); t.url = input.url; t.key = input.key } catch { return false } }
      if (t.kind === 'front-list') { if (typeof t.frontQuery !== 'string') return false; try { t.key = frontInboxTile(t.frontQuery).key } catch { return false } }
      if (t.kind === 'front-conversation') { try { const input = frontConversationTile(t.conversationID!); t.key = input.key; t.url = input.url } catch { return false } }
      if (t.kind === 'folder' || t.kind === 'file') { try { const input = fileTile(t.path!, t.kind); t.key = input.key; t.directory = input.directory } catch { return false } }
      if (t.kind === 'terminal') { try { const input = terminalTile(t.directory!, t.id); t.key = input.key; t.path = input.path } catch { return false } }
      if (ids.has(t.id) || keys.has(t.key)) return false
      ids.add(t.id); keys.add(t.key); return true
    }).map(t => ({ ...t, label: typeof t.label === 'string' ? t.label : undefined,
      workspaceID: t.status === 'visible' && typeof t.workspaceID === 'string' ? t.workspaceID : null,
      lastUsed: Number.isFinite(t.lastUsed) ? t.lastUsed : 0, shelvedAt: Number.isFinite(t.shelvedAt) ? t.shelvedAt : 0,
      context: t.context.filter(c => c && ['file', 'page'].includes(c.kind) && typeof c.id === 'string' && typeof c.name === 'string' && (c.text === undefined || typeof c.text === 'string') && (c.uri === undefined || typeof c.uri === 'string')),
    }))
    const slots = new Set<number>(), wsIDs = new Set<string>()
    s.workspaces = s.workspaces.filter(w => w && typeof w.id === 'string' && Number.isInteger(w.slot) && w.slot > 0 && Array.isArray(w.tileIDs) && !slots.has(w.slot) && !wsIDs.has(w.id) && (slots.add(w.slot), wsIDs.add(w.id), true)).map(w => ({ ...w, tileIDs: [...new Set(w.tileIDs)].filter(id => s.tiles.some(t => t.id === id && t.workspaceID === w.id && t.status === 'visible')) })).sort((a, b) => a.slot - b.slot)
    s.tiles = s.tiles.map(t => t.status === 'visible' && !s.workspaces.some(w => w.id === t.workspaceID && w.tileIDs.includes(t.id)) ? { ...t, status: 'shelf', workspaceID: null } : t)
    for (const w of s.workspaces) while (w.tileIDs.length > 4) { const id = w.tileIDs.shift()!; s.tiles = s.tiles.map(t => t.id === id ? { ...t, status: 'shelf', workspaceID: null } : t) }
    if (!s.workspaces.some(w => w.id === s.activeID)) s.activeID = 'home'
    s.folders = Array.isArray(s.folders) ? s.folders.filter(f => typeof f === 'string') : []
    s.pinned = Array.isArray(s.pinned) ? s.pinned.filter(f => typeof f === 'string') : []
    s.homeDraft = typeof s.homeDraft === 'string' ? s.homeDraft : ''
    s.selectedDirectory = typeof s.selectedDirectory === 'string' ? s.selectedDirectory : directory
    return tidy(s)
  } catch { return desktopInitial(directory) }
}
