import { useEffect, useRef, useState } from 'react'
import type { BrowserState } from '../../shared/types'
import { browserTile, fileTile, reconcileBrowser, terminalTile, type TileInput } from '../../shared/tiles'
import { terminalIntent } from '../../shared/sources'
import { normalizeURL, uid } from '../../shared/util'
import { api, friendlyError } from '../data'
import { BrowserPane } from '../Stage'
import { FileBody } from '../FileTiles'
import { TerminalBody } from '../TerminalTiles'
import { source, type Candidate } from './types'

export const urlLike = (s: string) => /^(https?:\/\/|localhost[:/]|127\.0\.0\.1[:/]|\[::1\])|^[^\s/]+\.[a-z]{2,}(?:[/:?#]\S*)?$/i.test(s)
const parentOf = (path: string) => path.replace(/\/[^/]*$/, '') || '/'

/** Browser: one tile per URL. Pages live in the main process; tiles only place them. */
export const browserSource = source<{ states: Record<string, BrowserState> }>({
  id: 'web', badge: 'web', kinds: ['browser'],
  use(env) {
    const [states, setStates] = useState<Record<string, BrowserState>>({})
    const envRef = useRef(env); envRef.current = env
    useEffect(() => api.onEvent(event => {
      const env = envRef.current
      if (event.type === 'browser-popup') { const parent = env.desktop.tiles.find(t => t.id === event.tileID); env.openURL(event.url, parent?.linkID) }
      if (event.type !== 'browser') return
      setStates(s => ({ ...s, [event.tab.id]: event.tab }))
      let url: string
      try { url = normalizeURL(event.tab.url) } catch { return }
      const duplicate = env.desktop.tiles.find(t => t.id !== event.tab.id && t.key === browserTile(url).key)
      env.setDesktop(s => reconcileBrowser(s, event.tab.id, url, event.tab.title || new URL(url).hostname))
      if (duplicate) void api.browserClose(event.tab.id).catch(() => {})
    }), [])
    return { states }
  },
  added: () => true,
  commands(q, _state, env) {
    const rows = []
    if (urlLike(q.text) && !q.text.startsWith('/') && (!q.scope || q.scope === 'web')) {
      try {
        const input = browserTile(q.text), existing = env.desktop.tiles.find(t => t.key === input.key)
        rows.push({ key: 'url', icon: 'web', title: input.title, source: 'Web page', subtitle: input.url!, action: existing?.status === 'visible' ? 'Go to tile' : 'Open in Browser', first: true, run: (mode: Parameters<typeof env.open>[1]) => env.open(input, mode) })
      } catch { /* Not a usable URL; stays a search. */ }
    }
    if (q.text && !q.text.startsWith('/') && (!q.scope || q.scope === 'web')) {
      const text = q.text.slice(0, 500)
      rows.push({ key: 'web-search', icon: 'search', title: `Search the web for “${text}”`, source: 'Web search', subtitle: 'DuckDuckGo', action: 'Search', run: (mode: Parameters<typeof env.open>[1]) => env.open(browserTile(`https://duckduckgo.com/?q=${encodeURIComponent(text)}`), mode) })
    }
    return rows
  },
  Tile({ tile, state, env }) {
    return <BrowserPane tab={{ id: tile.id, kind: 'browser', title: tile.title, url: tile.url! }} state={state.states[tile.id]} openAddress={() => env.address()} navigate={url => env.openURL(url, tile.linkID)} attachPage={id => env.attach(id)}
      screenshot={id => { void api.browserScreenshot(id).then(uri => { const owner = tile.linkID && env.desktop.tiles.find(t => t.id === tile.linkID); if (owner) env.changeTile(owner.id, { context: [...owner.context, { id: uid(), kind: 'image', name: 'Browser screenshot', uri }] }); else env.notify('Link this page to a tile that takes context to attach screenshots.') }).catch(e => env.reportError(friendlyError(e))) }}
      standalone={!tile.linkID} reportError={env.reportError} />
  },
  onShortcut: (action, _state, env) => { if (action !== 'new') return false; env.address(); return true },
  closed: tile => { void api.browserClose(tile.id).catch(() => {}) },
})

/** “~/git/ch” → the home-relative path. Paths are how people name folders. */
export const expandPath = (text: string, home: string) => text === '~' ? home : text.startsWith('~/') && home ? `${home}${text.slice(1)}` : text
const pathLike = (text: string) => text.startsWith('/') || text === '~' || text.startsWith('~/')
/** Path completion: list the folder a partial path points into, filtered by what follows the last “/”. */
async function completePath(text: string, home: string): Promise<Candidate[]> {
  const full = expandPath(text, home)
  const cut = full.endsWith('/') ? full.length : full.lastIndexOf('/') + 1
  const folder = full.slice(0, cut) || '/', prefix = full.slice(cut).toLowerCase()
  const page = await api.listFolder(folder.length > 1 ? folder.replace(/\/$/, '') : folder)
  return page.entries.filter(e => (e.kind === 'folder' || e.kind === 'file') && e.name.toLowerCase().startsWith(prefix) && (prefix.startsWith('.') || !e.name.startsWith('.')))
    .slice(0, 20).map((e, n) => ({ input: fileTile(e.path, e.kind === 'folder' ? 'folder' : 'file', e.name), score: 60 - n / 100 + (e.kind === 'folder' ? 1 : 0) }))
}

/** Files: folders and files on this machine. K finds them by name or path. */
export const filesSource = source<null>({
  id: 'files', badge: 'files', kinds: ['folder', 'file'],
  use: () => null,
  added: () => true,
  candidates(q, _state, env) {
    const known = [...new Set([...env.desktop.folders, ...env.desktop.tiles.filter(t => t.kind === 'folder').map(t => t.path!)])].filter(f => f && f !== '/')
    return known.map(directory => { const input = fileTile(directory, 'folder'); return { input, score: q.rank(`${input.title} ${directory}`) } })
  },
  search(q, _state, env) {
    if (q.scope && !['files', 'terminal'].includes(q.scope)) return undefined
    if (pathLike(q.text)) return completePath(q.text, env.home).catch(() => [])
    if (q.text.length < 2 || urlLike(q.text) || q.text.includes('/')) return undefined
    return api.findPaths(q.text).then(paths => paths.map((p): Candidate => ({ input: fileTile(p.path, p.kind, p.name), score: p.kind === 'folder' ? Math.max(q.rank(p.name), 5) : Math.max(q.rank(p.name), 4) })))
  },
  commands(q, _state, env) {
    if (!pathLike(q.text) || (q.scope && q.scope !== 'files')) return []
    const path = expandPath(q.text, env.home).replace(/(.)\/$/, '$1')
    return [{ key: 'local-path', icon: 'files', title: q.text, source: 'Local path', subtitle: path === q.text ? 'folder, text or image · read-only' : path, action: 'Open', first: true, others: [{ label: 'Open terminal here', key: 't', icon: 'terminal', run: mode => env.openTerminal(path, mode) }], run: async mode => { const target = await api.inspectPath(path); env.open(fileTile(target.path, target.kind), mode) } }]
  },
  others: (input, _state, env) => input.kind === 'file' ? [{ label: 'Show in folder', icon: 'folder' as const, run: async mode => { const target = await api.inspectPath(parentOf(input.path!)); env.open(fileTile(target.path, target.kind), mode) } }] : [],
  onShortcut: (action, _state, env) => { if (action !== 'new') return false; env.ask('', 'files'); return true },
  Tile: ({ tile, env }) => <FileBody tile={tile} env={env} others={env.othersFor(tile).filter(a => a.label !== 'Show in folder')} />,
})

/** Terminal: a shell in a folder, or at home when there is none. */
export const terminalSource = source<null>({
  id: 'terminal', badge: 'terminal', kinds: ['terminal'],
  use: () => null,
  added: () => true,
  commands(q, _state, env) {
    const shell = terminalIntent(q.raw)
    const scoped = q.scope === 'terminal'
    if (!shell && !scoped) return []
    const focused = env.desktop.tiles.find(t => t.id === env.desktop.workspaces.find(w => w.id === env.desktop.activeID)?.focusedID)
    const focusedDirectory = focused?.kind === 'file' ? parentOf(focused.path!) : focused?.directory
    const asked = (shell ? shell[1] : q.text)?.trim()
    const where = (dir: string) => dir === env.home ? '~' : env.home && dir.startsWith(`${env.home}/`) ? `~${dir.slice(env.home.length)}` : dir
    // A path is used as typed; a name is searched (async) below. With nothing typed: the focused folder, or home.
    const dir = asked && pathLike(asked) ? expandPath(asked, env.home).replace(/(.)\/$/, '$1') : !asked ? focusedDirectory || env.home : undefined
    if (!dir) return []
    return [{ key: 'terminal', icon: 'terminal', title: 'Terminal', source: 'Terminal', subtitle: `in ${where(dir)}${!asked && focusedDirectory ? ', the focused folder' : ''}`, action: 'Open terminal', first: true, run: mode => env.openTerminal(dir, mode) }]
  },
  search(q, _state, env) {
    // Narrowed to Terminal, a folder name or partial path offers terminals in the matching folders.
    if (q.scope !== 'terminal' || !q.text) return undefined
    const folders = pathLike(q.text) ? completePath(q.text, env.home).catch(() => []) : q.text.length < 2 ? Promise.resolve([]) : api.findPaths(q.text).then(paths => paths.map(p => ({ input: fileTile(p.path, p.kind, p.name), score: Math.max(q.rank(p.name), 5) })))
    return folders.then(found => found.filter(c => c.input.kind === 'folder').map(c => ({ input: { ...terminalTile(c.input.path!), title: `Terminal in ${c.input.title}` }, score: c.score })))
  },
  others(input: TileInput, _state, env) {
    const dir = input.kind === 'file' ? parentOf(input.path!) : input.kind === 'terminal' ? undefined : input.path || input.directory
    return dir?.startsWith('/') ? [{ label: 'Open terminal here', key: 't', icon: 'terminal' as const, run: mode => env.openTerminal(dir, mode) }] : []
  },
  onShortcut: (action, _state, env) => {
    if (action !== 'new-terminal' && action !== 'new') return false
    const focused = env.desktop.tiles.find(t => t.id === env.desktop.workspaces.find(w => w.id === env.desktop.activeID)?.focusedID)
    env.openTerminal(action === 'new' ? focused?.directory : undefined)
    return true
  },
  Tile: ({ tile, env, visible, focused, focusKey }) => <TerminalBody tile={tile} visible={visible} focused={focused} focusKey={focusKey} consumeDraft={() => env.changeTile(tile.id, { draft: '' })} />,
  closed: tile => { void api.terminalClose(tile.id).catch(() => {}) },
})
export { terminalTile }
