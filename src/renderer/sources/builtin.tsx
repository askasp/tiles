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
  closed: tile => { void api.browserClose(tile.id).catch(() => {}) },
})

/** Files: folders and files on this machine. K finds them by name. */
export const filesSource = source<null>({
  id: 'files', badge: 'files', kinds: ['folder', 'file'],
  use: () => null,
  added: () => true,
  candidates(q, _state, env) {
    const known = [...new Set([...env.desktop.folders, ...env.desktop.tiles.filter(t => t.kind === 'folder').map(t => t.path!)])].filter(f => f && f !== '/')
    return known.map(directory => { const input = fileTile(directory, 'folder'); return { input, score: q.rank(`${input.title} ${directory}`) } })
  },
  search(q) {
    if (q.text.length < 2 || urlLike(q.text) || q.text.includes('/') || (q.scope && !['files', 'terminal'].includes(q.scope))) return undefined
    return api.findPaths(q.text).then(paths => paths.map((p): Candidate => ({ input: fileTile(p.path, p.kind, p.name), score: p.kind === 'folder' ? Math.max(q.rank(p.name), 5) : Math.max(q.rank(p.name), 4) })))
  },
  commands(q, _state, env) {
    if (!q.text.startsWith('/') || (q.scope && q.scope !== 'files')) return []
    const path = q.text
    return [{ key: 'local-path', icon: 'files', title: path, source: 'Local path', subtitle: 'folder, text or image · read-only', action: 'Open', first: true, others: [{ label: 'Open terminal here', run: mode => env.openTerminal(path, mode) }], run: async mode => { const target = await api.inspectPath(path); env.open(fileTile(target.path, target.kind), mode) } }]
  },
  others: (input, _state, env) => input.kind === 'file' ? [{ label: 'Show in folder', icon: 'folder' as const, run: async mode => { const target = await api.inspectPath(parentOf(input.path!)); env.open(fileTile(target.path, target.kind), mode) } }] : [],
  Tile: ({ tile, env }) => <FileBody tile={tile} open={env.open} replace={input => env.replaceTile(tile.id, input)} actions={env.othersFor(tile).filter(a => a.label !== 'Show in folder')} />,
})

/** Terminal: a shell in a folder. */
export const terminalSource = source<null>({
  id: 'terminal', badge: 'terminal', kinds: ['terminal'],
  use: () => null,
  added: () => true,
  commands(q, _state, env) {
    const shell = terminalIntent(q.raw)
    if (!shell) return []
    const focused = env.desktop.tiles.find(t => t.id === env.desktop.workspaces.find(w => w.id === env.desktop.activeID)?.focusedID)
    const focusedDirectory = focused?.kind === 'file' ? parentOf(focused.path!) : focused?.directory
    const asked = shell[1]?.trim()
    const dir = asked?.startsWith('/') ? asked : env.desktop.folders.find(f => asked && f.toLowerCase().includes(asked.toLowerCase())) || focusedDirectory || env.home
    return [{ key: 'terminal', icon: 'terminal', title: 'Terminal', source: 'Terminal', subtitle: `in ${dir === env.home ? '~' : dir}${!asked && focusedDirectory ? ', the focused folder' : ''}`, action: 'Open terminal', first: true, run: mode => env.openTerminal(dir, mode) }]
  },
  others(input: TileInput, _state, env) {
    const dir = input.kind === 'file' ? parentOf(input.path!) : input.kind === 'terminal' ? undefined : input.path || input.directory
    return dir?.startsWith('/') ? [{ label: 'Open terminal here', key: 't', icon: 'terminal' as const, run: mode => env.openTerminal(dir, mode) }] : []
  },
  onShortcut: (action, _state, env) => { if (action !== 'new-terminal') return false; env.openTerminal(); return true },
  Tile: ({ tile, env, visible, focused, focusKey }) => <TerminalBody tile={tile} visible={visible} focused={focused} focusKey={focusKey} consumeDraft={() => env.changeTile(tile.id, { draft: '' })} />,
  closed: tile => { void api.terminalClose(tile.id).catch(() => {}) },
})
export { terminalTile }
