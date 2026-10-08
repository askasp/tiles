import { ArrowUpRight, FileText, FolderOpen, Globe, LayoutGrid, Mail, MessageSquare, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ServiceSearch, SessionInfo } from '../shared/types'
import type { OpenMode, Tile, TileDesktop, TileInput } from '../shared/tiles'
import { browserTile, fileTile, focusedTile, frontConversationTile, frontInboxTile, projectsTile, projectTile, recipeTile, sessionTile, shelfTiles, tileTitle } from '../shared/tiles'
import type { ConnectorInfo, ConnectorSearch } from '../shared/connectors'
import { launcherIntent, launcherScope, resourceAction, resourceSource, sources, type SourceID } from '../shared/sources'
import { frontConversationID } from '../shared/front'
import { basename, sessionTitle } from '../shared/workspaces'
import type { ProjectEntry } from './Home'
import { api, friendlyError } from './data'
import { IconButton, Modal, Status } from './ui'

export const tileSource = (tile: Tile) => tile.kind === 'recipe' ? tile.sourceName || tile.resource?.connectorID || 'Connector' : sources.find(s => s.id === resourceSource(tile))!.name
export function TileIcon({ kind, size = 15 }: { kind: TileInput['kind']; size?: number }) {
  return kind === 'file' ? <FileText size={size} /> : kind === 'folder' ? <FolderOpen size={size} /> : kind.startsWith('front-') ? <Mail size={size} /> : kind === 'browser' ? <Globe size={size} /> : kind === 'project' ? <FolderOpen size={size} /> : kind === 'session' ? <MessageSquare size={size} /> : <LayoutGrid size={size} />
}
export function tileLocation(tile: Tile, desktop: TileDesktop) {
  const w = desktop.workspaces.find(w => w.id === tile.workspaceID)
  return tile.status === 'shelf' ? 'Shelf' : tile.status === 'closed' ? 'Closed · reopen' : `Workspace ${w?.slot || '?'} · ${w?.title || ''}`
}
const urlLike = (s: string) => /^(https?:\/\/|localhost[:/]|127\.0\.0\.1[:/]|\[::1\])|^[^\s/]+\.[^\s]+$/.test(s)
const rank = (text: string, query: string) => {
  text = text.toLowerCase(); query = query.toLowerCase()
  if (!query) return 1
  if (text === query) return 100
  if (text.startsWith(query)) return 50
  return query.split(/\s+/).every(word => text.includes(word)) ? 10 : 0
}
export function TileLauncher({ desktop, sessions, projects, waiting, open, newSession, tidy, undo, close, serviceLinks, initialSource, connectors, manageConnectors }: {
  desktop: TileDesktop; sessions: SessionInfo[]; projects: ProjectEntry[]; waiting: string[];
  open: (input: TileInput, mode: OpenMode) => void; newSession: (directory?: string, mode?: OpenMode, project?: boolean) => void;
  tidy: (id: string) => void; undo: () => void; close: () => void; serviceLinks: { name: string; url: string; front?: boolean }[];
  initialSource?: SourceID;
  connectors: ConnectorInfo[]; manageConnectors: () => void;
}) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SourceID | undefined>(initialSource)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const [index, setIndex] = useState(0)
  const [remote, setRemote] = useState<SessionInfo[]>([])
  const [remoteError, setRemoteError] = useState(false)
  const [searching, setSearching] = useState(false)
  const [providerResult, setProviderResult] = useState<ServiceSearch>({ resources: [] })
  const [providerBusy, setProviderBusy] = useState(false)
  const [connectorResult, setConnectorResult] = useState<ConnectorSearch>({ resources: [], errors: [] })
  const [connectorBusy, setConnectorBusy] = useState(false)
  const searchVersion = useRef(0)
  const list = useRef<HTMLDivElement>(null)
  const tidyQuery = /^(just |hide everything but |keep only )/i.test(query.trim())
  const intent = launcherIntent(query, scope)
  const clean = intent.query, source = launcherScope(query, scope), providerSource = intent.source
  const targetQuery = tidyQuery ? query.trim().replace(/^(just |hide everything but |keep only )/i, '') : clean
  const providerQuery = providerSource && ['front', 'slack', 'github'].includes(providerSource) ? `${providerSource === 'slack' && /^dm(?:\s|:)/i.test(query.trim()) ? 'dm' : sources.find(s => s.id === providerSource)!.prefix} ${clean}` : ''
  useEffect(() => {
    setRemote([]); setRemoteError(false)
    if (!clean || urlLike(clean) || tidyQuery || intent.create || (source && source !== 'opencode')) { setSearching(false); return }
    let valid = true
    setSearching(true)
    const timer = setTimeout(() => { void api.sessions({ search: clean }).then(page => { if (valid) { setRemote(page.data); setRemoteError(false) } }).catch(() => { if (valid) setRemoteError(true) }).finally(() => { if (valid) setSearching(false) }) }, 180)
    return () => { valid = false; clearTimeout(timer) }
  }, [clean, tidyQuery, source, intent.create])
  useEffect(() => {
    setProviderResult({ resources: [] })
    if (!providerQuery || tidyQuery) { setProviderBusy(false); return }
    let valid = true; setProviderBusy(true)
    const timer = setTimeout(() => { void api.searchServices(providerQuery).then(result => { if (valid) setProviderResult(result) }).catch(() => { if (valid) setProviderResult({ resources: [], error: 'Could not search this source.' }) }).finally(() => { if (valid) setProviderBusy(false) }) }, 350)
    return () => { valid = false; clearTimeout(timer) }
  }, [providerQuery, tidyQuery])
  useEffect(() => {
    const version = ++searchVersion.current
    setConnectorResult({ resources: [], errors: [] })
    if ((!clean || clean.length < 2) || urlLike(clean) || tidyQuery || intent.create || (source && !source.startsWith('connector:')) || !connectors.length) { setConnectorBusy(false); return }
    setConnectorBusy(true)
    const timer = setTimeout(() => { void api.searchConnectors(clean, source?.startsWith('connector:') ? source.slice(10) : undefined).then(result => { if (version === searchVersion.current) setConnectorResult(result) }).catch(e => { if (version === searchVersion.current) setConnectorResult({ resources: [], errors: [friendlyError(e)] }) }).finally(() => { if (version === searchVersion.current) setConnectorBusy(false) }) }, 400)
    return () => { clearTimeout(timer); searchVersion.current++ }
  }, [clean, source, tidyQuery, intent.create, connectors])
  const askAI = async () => {
    const version = ++searchVersion.current; setConnectorBusy(true); setOpenError('')
    try { const result = await api.planConnectorSearch(query); if (version === searchVersion.current) setConnectorResult(result) }
    catch (e) { if (version === searchVersion.current) setOpenError(friendlyError(e)) }
    finally { if (version === searchVersion.current) setConnectorBusy(false) }
  }
  const actions = useMemo(() => {
    const candidates: { input: TileInput; existing?: Tile; score: number }[] = desktop.tiles.map(tile => ({ input: { ...tile, title: tileTitle(tile) }, existing: tile, score: Math.max(rank(`${tileTitle(tile)} ${tile.title} ${tile.url || ''} ${tile.frontQuery || ''} ${tile.path || ''} ${tile.directory || ''} ${tile.kind}`, targetQuery), query.trim() ? rank(tileTitle(tile), query.trim()) : 0) }))
    const keys = new Set(desktop.tiles.map(t => t.key))
    for (const input of [projectsTile(), ...connectors.flatMap(c => c.definition.recipes.filter(r => r.shape === 'collection' && !c.definition.operations.find(op => op.id === r.operation)?.path.includes('{parent}')).map(r => recipeTile({ connectorID: c.definition.id, recipeID: r.id }, r.label, r, c.definition.name)))]) {
      if (!keys.has(input.key)) { candidates.push({ input, score: rank(`${input.title} ${input.sourceName || 'OpenCode projects'}`, targetQuery) }); keys.add(input.key) }
    }
    for (const session of [...remote, ...sessions]) {
      const input = sessionTile(session)
      if (!keys.has(input.key)) { candidates.push({ input, score: Math.max(rank(`${input.title} ${input.directory || ''}`, targetQuery), query.trim() ? rank(input.title, query.trim()) : 0) }); keys.add(input.key) }
    }
    for (const project of projects) {
      for (const input of [fileTile(project.directory, 'folder', project.name), projectTile(project.directory, project.name)]) {
        if (!keys.has(input.key)) { candidates.push({ input, score: rank(`${project.name} ${project.directory}`, targetQuery) }); keys.add(input.key) }
      }
    }
    const focused = focusedTile(desktop)
    if (focused?.directory) {
      const review: TileInput = { key: `review:${focused.directory}`, kind: 'review', title: `Review changes · ${basename(focused.directory)}`, directory: focused.directory }
      if (!keys.has(review.key)) candidates.push({ input: review, score: rank(review.title, targetQuery) })
    }
    if (focused?.sessionID) {
      const details: TileInput = { key: `details:${focused.sessionID}`, kind: 'details', title: `Details · ${focused.title}`, directory: focused.directory, sessionID: focused.sessionID, linkID: focused.kind === 'session' ? focused.id : focused.linkID }
      if (!keys.has(details.key)) candidates.push({ input: details, score: rank(details.title, targetQuery) })
    }
    for (const link of serviceLinks) {
      try { const input = link.front ? frontInboxTile('is:open', 'Front · API inbox') : { ...browserTile(link.url), title: link.name }; if (!keys.has(input.key)) candidates.push({ input, score: rank(link.name, targetQuery) }) } catch { /* Bad saved URL cannot break search. */ }
    }
    for (const resource of providerResult.resources) {
      try {
        const frontID = resource.service === 'front' ? frontConversationID(resource.url) : undefined
        const input = frontID ? { ...frontConversationTile(frontID, resource.title), label: resource.title } : { ...browserTile(resource.url), title: resource.title, label: resource.title }
        const existing = candidates.find(c => c.input.key === input.key)
        if (existing) { existing.score = 100; if (frontID) existing.input = { ...input, title: existing.input.title } }
        else candidates.push({ input, score: 100 })
      } catch { /* Unsafe provider URLs are never opened. */ }
    }
    for (const resource of connectorResult.resources) {
      const connector = connectors.find(c => c.definition.id === resource.ref.connectorID)
      const recipe = connector?.definition.recipes.find(r => r.id === resource.ref.recipeID)
      if (!recipe || !connector) continue
      const input = recipeTile(resource.ref, resource.title, recipe, connector.definition.name)
      const existing = candidates.find(c => c.input.key === input.key)
      if (existing) existing.score = 100
      else { candidates.push({ input, score: 100 }); keys.add(input.key) }
    }
    const matches = candidates.filter(c => c.score > 0 && !intent.create && (!source || resourceSource(c.input) === source) && (!tidyQuery || !!c.existing)).sort((a, b) => b.score - a.score || (b.existing?.lastUsed || 0) - (a.existing?.lastUsed || 0)).slice(0, 30)
    const openResource = async (input: TileInput, mode: OpenMode) => {
      if (input.kind === 'folder' || input.kind === 'file') {
        const path = await api.inspectPath(input.path!)
        open(fileTile(path.path, path.kind), mode)
      } else open(input, mode)
    }
    const result: { key: string; title: string; description: string; kind: TileInput['kind']; waiting: boolean; scope?: SourceID; run: (mode: OpenMode) => void | Promise<void> }[] = matches.map(({ input, existing }) => ({
      key: input.key, title: tidyQuery ? `Keep only ${input.title} + linked tiles` : input.title,
      description: `${resourceAction(input)} · ${existing ? tileLocation(existing, desktop) : input.path || input.directory || input.url || 'Native tile'}`,
      kind: input.kind, waiting: !!input.sessionID && waiting.includes(input.sessionID),
      run: (mode: OpenMode) => { if (tidyQuery && existing) tidy(existing.id); else return openResource(input, mode) },
    }))
    if (urlLike(clean) && !clean.startsWith('/') && !tidyQuery && !intent.create && (!source || source === 'web')) {
      try { const input = browserTile(clean), existing = desktop.tiles.find(t => t.key === input.key); result.unshift({ key: 'url', title: clean, kind: 'browser', description: `${resourceAction(input)} · ${existing ? tileLocation(existing, desktop) : 'One URL, one tile · no nested tabs'}`, waiting: false, run: mode => open(input, mode) }) } catch { /* Invalid URL remains searchable. */ }
    }
    if (!tidyQuery) {
      if (source === 'front' && !intent.create && clean.length <= 300) {
        const input = frontInboxTile(clean || 'is:open')
        result.unshift({ key: 'front-filter', title: clean ? `Front API inbox · ${clean}` : 'Front · API inbox', kind: 'front-list', description: 'Front · Inbox · Read conversations · mail is not changed', waiting: false, run: mode => open(input, mode) })
      }
      if (intent.create) {
        for (const project of projects.filter(p => clean && rank(`${p.name} ${p.directory}`, clean))) result.push({ key: `new-session:${project.directory}`, title: `Start session in ${project.name}`, kind: 'session', description: `OpenCode · Create session · ${project.directory} · no prompt sent`, waiting: false, run: mode => newSession(project.directory, mode) })
        if (!clean) result.push({ key: 'new-session', title: 'New session', kind: 'session', description: 'OpenCode · Create session · selected project · no prompt sent', waiting: false, run: mode => newSession(undefined, mode) })
      }
      if (!intent.create && clean.startsWith('/') && (!source || source === 'files')) result.unshift({ key: 'local-path', title: clean, kind: 'folder', description: 'Files · Open local path · folder or text preview · read-only', waiting: false, run: async mode => { const path = await api.inspectPath(clean); open(fileTile(path.path, path.kind), mode) } })
      if (!source && !intent.create) {
        for (const entry of sources.filter(s => !clean || s.name.toLowerCase() === clean.toLowerCase())) result[clean ? 'unshift' : 'push']({ key: `source:${entry.id}`, title: entry.name, kind: entry.id === 'files' ? 'folder' : 'project', description: `Source · Search ${entry.hint.toLowerCase()} · Enter to narrow`, scope: entry.id, waiting: false, run: () => {} })
      }
    }
    return result
  }, [desktop, projects, sessions, remote, targetQuery, clean, query, source, intent.create, tidyQuery, serviceLinks, waiting, open, newSession, tidy, providerResult, connectors, connectorResult])
  useEffect(() => { list.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }) }, [index])
  const chosen = Math.min(index, actions.length - 1)
  const execute = async (mode: OpenMode, i = chosen) => {
    if (!actions[i] || opening) return
    if (actions[i].scope) { setScope(actions[i].scope); setQuery(''); setIndex(0); setOpenError(''); return }
    setOpening(true); setOpenError('')
    try { await actions[i].run(mode); close() } catch (e) { setOpenError(friendlyError(e)); setOpening(false) }
  }
  return <Modal title="Launcher" close={close}>
    <div className="launcher-input"><Search size={18} /><input autoFocus aria-label="Launcher search" placeholder="Find a resource… or “browse chatos files”" value={query} onChange={e => { setQuery(e.target.value); setIndex(0); setOpenError(''); setProviderResult({ resources: [] }); setRemote([]) }} onKeyDown={e => {
      if (e.nativeEvent.isComposing) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, Math.min(actions.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
      if (e.key === 'Enter') { e.preventDefault(); if (/^(?:add|connect)(?:\s|$)/i.test(query)) manageConnectors(); else void execute(e.shiftKey ? 'move' : e.ctrlKey ? 'new' : 'here') }
      if (e.key === 'Backspace' && !query && scope) { e.preventDefault(); setScope(undefined); setIndex(0) }
      if (e.key === 'z' && e.ctrlKey && !query) { e.preventDefault(); undo() }
    }} /><IconButton label="Close launcher" onClick={close}><X size={15} /></IconButton></div>
    <nav className="launcher-sources" aria-label="Search sources"><button className={`pill ${!source ? 'primary' : ''}`} aria-pressed={!source} onClick={() => { setScope(undefined); setQuery(clean); setIndex(0) }}>All sources</button>{[...sources, ...connectors.map(c => ({ id: `connector:${c.definition.id}` as SourceID, name: c.definition.name }))].map(s => <button key={s.id} className={`pill ${source === s.id ? 'primary' : ''}`} aria-pressed={source === s.id} onClick={() => { setScope(s.id); setQuery(clean); setIndex(0); setOpenError('') }}>{s.name}</button>)}<button className="pill" onClick={manageConnectors}>Add source</button>{!!connectors.length && <button className="pill" disabled={connectorBusy || !query.trim()} onClick={() => void askAI()}>Ask AI to find…</button>}</nav>
    {/^(?:add|connect)(?:\s|$)/i.test(query) && <button className="launcher-result" onClick={manageConnectors}>Build a connector · inspect and approve a resource → tile mapping</button>}
    {openError && <div className="inline-error" role="alert">{openError}</div>}
    {!!connectorResult.errors.length && <div className="inline-error">{connectorResult.errors.slice(0, 2).join(' · ')}</div>}
    <div className="tile-launcher-results" ref={list}>{actions.map((action, i) => <button disabled={opening} className={`launcher-result ${i === chosen ? 'selected' : ''}`} key={action.key} onMouseEnter={() => setIndex(i)} onClick={e => void execute(e.shiftKey ? 'move' : e.ctrlKey ? 'new' : 'here', i)}>
      <span className="launcher-result-icon"><TileIcon kind={action.kind} size={17} /></span><span className="launcher-result-copy"><strong className="truncate">{action.title}</strong><small className="truncate">{action.description}</small></span>{action.waiting && <Status waiting />}<ArrowUpRight size={13} />
    </button>)}{!actions.length && <div className="empty-list">{providerBusy || searching ? 'Searching… Enter won’t create an unrelated session.' : 'No matching tiles. Try a title, project name, or full URL.'}</div>}</div>
    <footer className="modal-footer"><span>↵ open / go there · Shift+↵ move here · Ctrl+↵ new workspace{source && ' · empty Backspace: all sources'}<br />{opening ? 'Opening resource…' : providerBusy || connectorBusy ? 'Searching connected source…' : providerResult.error || (providerResult.more ? 'Showing the first source results; narrow your query for more.' : searching ? 'Searching server sessions…' : remoteError ? 'Server search unavailable; showing local tiles.' : 'Source and action are explicit. To create: “start session in chatos”.')}</span></footer>
  </Modal>
}

export function TileOverview({ desktop, waiting, focus, move, go, close }: { desktop: TileDesktop; waiting: string[]; focus: (id: string) => void; move: (id: string, slot: number) => void; go: (slot: number) => void; close: () => void }) {
  const [destination, setDestination] = useState(desktop.workspaces.find(w => w.id === desktop.activeID)?.slot || 1)
  return <Modal title="Workspace overview" close={close} wide>
    <div className="modal-heading"><LayoutGrid size={18} /><h2>Workspaces & shelf</h2><span className="muted">One tile, one place</span><IconButton label="Close overview" onClick={close}><X size={15} /></IconButton></div>
    <div className="tile-overview"><div className="tile-workspace-cards">{desktop.workspaces.map(w => <section className={`tile-workspace-card ${desktop.activeID === w.id ? 'selected' : ''}`} key={w.id} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); move(e.dataTransfer.getData('text/chatos-tile'), w.slot); close() }}>
      <button className="overview-workspace-heading" onClick={() => { go(w.slot); close() }}><kbd>{w.slot}</kbd><strong>{w.title}</strong><span>{w.tileIDs.length}/4</span></button>
      {w.tileIDs.map(id => { const t = desktop.tiles.find(t => t.id === id)!; return <button className="overview-tile-row" key={id} draggable onDragStart={e => e.dataTransfer.setData('text/chatos-tile', id)} onClick={() => { focus(id); close() }}><TileIcon kind={t.kind} /><span className="truncate">{tileTitle(t)}</span>{t.sessionID && waiting.includes(t.sessionID) && <Status waiting />}</button> })}
      {!w.tileIDs.length && <p className="muted">Empty · open something with Super+K</p>}
    </section>)}</div>
    <aside className="overview-shelf"><h3>Shelf · {shelfTiles(desktop).length}</h3><label className="form-field">Move selected tile to workspace<input aria-label="Shelf destination workspace" type="number" min={1} value={destination} onChange={e => setDestination(Math.max(1, Number(e.target.value)))} /></label>
      {shelfTiles(desktop).map(t => <div className="overview-shelf-row" key={t.id} draggable onDragStart={e => e.dataTransfer.setData('text/chatos-tile', t.id)}><button onClick={() => { focus(t.id); close() }}><TileIcon kind={t.kind} /><span className="truncate">{tileTitle(t)}</span>{t.sessionID && waiting.includes(t.sessionID) && <Status waiting />}</button><button className="text-button" aria-label={`Move ${tileTitle(t)} to workspace ${destination}`} onClick={() => { move(t.id, destination); close() }}>Move</button></div>)}
      {!shelfTiles(desktop).length && <p className="muted">Hidden tiles stay live here. Search finds closed tiles too.</p>}
    </aside></div>
    <footer className="modal-footer"><button className="text-button" onClick={() => { go(0); close() }}>Projects & sessions</button><span>Drag a tile onto a workspace, or use Move. Sessions keep running.</span></footer>
  </Modal>
}
