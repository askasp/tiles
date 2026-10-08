import { Expand, FolderOpen, GitCompare, LayoutGrid, Link, Pencil, Plus, Settings, SquareTerminal, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BrowserContext, BrowserState, ServiceInfo, SessionInfo } from '../shared/types'
import type { ModelInfo } from '../shared/model'
import { shortcutFor } from '../shared/shortcuts'
import { activeWorkspace, browserTile, fileTile, directionTile, focusTile, focusedTile, frontConversationTile, frontInboxTile, fullscreenTile, goWorkspace, moveTile, openTile, projectTile, promoteTile, reconcileBrowser, restoreDesktop, restoreLast, serializeDesktop, sessionTile, shelfTile, shelfTiles, terminalTile, tidyAround, tileTitle, undoArrangement, updateTile, type Direction, type OpenMode, type Tile, type TileDesktop, type TileInput } from '../shared/tiles'
import { builtinSources, resourceSource, sources, type SourceID } from '../shared/sources'
import { frontConversationID } from '../shared/front'
import { basename, directoryOf, normalizeURL, sessionTitle, uid } from '../shared/workspaces'
import { Chat } from './Chat'
import { Composer } from './Composer'
import { AddressDialog, RenameDialog, SendPage, Settings as SettingsDialog } from './Overlays'
import { BrowserPane, Review } from './Stage'
import { FrontConversationBody, FrontInbox } from './FrontTiles'
import { FileBody } from './FileTiles'
import { TerminalBody } from './TerminalTiles'
import { Badge, TileLauncher, TileOverview, tileBadge, tileSource } from './TileOverlays'
import { api, friendlyError, useDesktopData, useSessionList, type ProjectEntry } from './data'
import { IconButton, Status } from './ui'
import { ConnectorSettings } from './ConnectorSettings'
import { RecipeBody } from './RecipeTiles'
import type { ConnectorDefinition, ConnectorInfo } from '../shared/connectors'

const STORAGE = 'chatos.desktop.v2'
type Overlay = 'launcher' | 'address' | 'overview' | 'settings' | 'connectors' | 'rename' | 'send-page' | null
type Catalog = Awaited<ReturnType<typeof api.catalog>>
type Data = ReturnType<typeof useDesktopData>

function SessionBody({ tile, data, focused, visible, focusKey, change, send, sending, openURL, reportError }: {
  tile: Tile; data: Data; focused: boolean; visible: boolean; focusKey: number; change: (patch: Partial<Tile>) => void;
  send: (tile: Tile, delivery: 'steer' | 'queue') => void; sending: boolean; openURL: (url: string) => void; reportError: (message: string) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>()
  const session = data.sessions[tile.sessionID!], detail = data.details[tile.sessionID!]
  const running = data.active.includes(tile.sessionID!)
  useEffect(() => {
    let valid = true
    if (tile.directory && data.connection.connected) void api.catalog(tile.directory).then(c => { if (valid) setCatalog(c) }).catch(e => { if (valid) reportError(friendlyError(e)) })
    return () => { valid = false }
  }, [tile.directory, data.connection.connected, reportError])
  const refresh = () => data.refreshSession(tile.sessionID!)
  const interrupt = () => { void api.interrupt(tile.sessionID!).then(refresh).catch(e => reportError(friendlyError(e))) }
  return <><Chat visible={visible} detail={detail} running={running} loading={!detail && data.connection.connected} older={() => data.olderMessages(tile.sessionID!)} refresh={() => void refresh()} reportError={reportError} openURL={openURL} />
    <Composer draft={tile.draft} setDraft={draft => change({ draft })} context={tile.context} removeContext={id => change({ context: tile.context.filter(c => c.id !== id) })}
      attach={() => { void api.chooseFiles().then(files => change({ context: [...tile.context, ...files.map(file => ({ id: uid(), kind: 'file' as const, ...file }))] })).catch(e => reportError(friendlyError(e))) }}
      agents={catalog?.agents || []} models={catalog?.models || []} agent={session?.agent} model={session?.model || catalog?.defaultModel}
      setAgent={agent => { if (agent) void api.switchAgent(tile.sessionID!, agent).then(refresh).catch(e => reportError(friendlyError(e))) }}
      setModel={model => { const m = model || catalog?.defaultModel; if (m) void api.switchModel(tile.sessionID!, m).then(refresh).catch(e => reportError(friendlyError(e))) }}
      send={delivery => send(tile, delivery)} interrupt={interrupt} running={running} sending={sending} disabled={!data.connection.connected} focusKey={focused ? focusKey : 0} />
  </>
}

/** C2: actions first, then the project's sessions. Sessions already on the desktop say where. */
function ProjectBody({ tile, data, desktop, open, create, browse, terminal, review }: { tile: Tile; data: Data; desktop: TileDesktop; open: (s: SessionInfo) => void; create: () => void; browse: () => void; terminal: () => void; review: () => void }) {
  const project = data.snapshot?.projects.find(p => p.canonical === tile.directory)
  const list = useSessionList(project ? { project: project.id } : { directory: tile.directory }, data.connection.connected, data.ingest)
  const [filter, setFilter] = useState('')
  const placed = (id: string) => { const t = desktop.tiles.find(t => t.sessionID === id && t.kind === 'session'); return t?.status === 'visible' ? t.workspaceID === tile.workspaceID ? 'tiled here' : `open on ${desktop.workspaces.find(w => w.id === t.workspaceID)?.slot}` : t?.status === 'shelf' ? 'on shelf' : '' }
  return <div className="project-tile-body"><div className="project-actions"><button className="pill primary" onClick={create}><Plus size={13} />Start session</button><button className="pill" onClick={review}><GitCompare size={13} />Review changes</button><button className="pill" onClick={browse}><FolderOpen size={13} />Browse files</button><button className="pill" onClick={terminal}><SquareTerminal size={13} />Terminal</button></div>
    <div className="project-tile-toolbar"><input aria-label={`Search sessions in ${tile.title}`} placeholder="Filter sessions…" value={filter} onChange={e => setFilter(e.target.value)} /></div>
    <span className="k-head">Sessions</span>
    {list.page.data.filter(s => sessionTitle(s).toLowerCase().includes(filter.toLowerCase())).map(s => <button className="session-row" key={s.id} onClick={() => open(s)}><Status running={data.active.includes(s.id)} waiting={data.waiting.includes(s.id)} /><span className="truncate">{sessionTitle(s)}</span>{placed(s.id) && <span className="placed-badge">{placed(s.id)}</span>}</button>)}
    {list.loading && <div className="list-loading">Loading sessions…</div>}{list.error && <div className="inline-error">{list.error}<button className="text-button" onClick={() => void list.refresh()}>Retry</button></div>}
    {data.connection.connected && !list.loading && !list.page.data.length && <div className="empty-list">No sessions here yet.</div>}
    {list.page.cursor.next && <button className="pill load-more" onClick={() => void list.refresh(list.page.cursor.next!)}>More sessions</button>}
  </div>
}

const builtinKinds: Tile['kind'][] = ['browser', 'folder', 'file', 'terminal', 'session', 'review', 'details', 'front-list', 'front-conversation']
const kindChip = (tile: Tile) => {
  const source = tile.kind === 'recipe' ? (tile.sourceName || 'connector').toLowerCase() : sources.find(s => s.id === resourceSource(tile))!.name.toLowerCase()
  const kind = { browser: 'page', folder: 'folder', file: 'file', terminal: 'shell', session: 'session', projects: 'list', project: 'list', review: 'diff', details: 'record', 'front-list': 'list', 'front-conversation': 'conversation', recipe: tile.resource?.resourceID ? 'item' : 'list' }[tile.kind]
  return { text: `${source} · ${kind} · ${builtinKinds.includes(tile.kind) || tile.kind === 'project' || tile.kind === 'projects' ? 'built-in' : 'generated'}`, generated: tile.kind === 'recipe' }
}

export default function App() {
  const [launcherSource, setLauncherSource] = useState<SourceID>()
  const [launcherQuery, setLauncherQuery] = useState<string>()
  const [toast, setToast] = useState<{ text: string; error?: boolean; key?: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notify = useCallback((text: string, error = false, key?: string) => { setToast({ text, error, key }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), error ? 8_000 : 4_000) }, [])
  const reportError = useCallback((text: string) => notify(text, true), [notify])
  const data = useDesktopData(reportError)
  const [boot] = useState(() => {
    let legacy: string | null = null
    try { legacy = localStorage.getItem(STORAGE) || localStorage.getItem('chatos.workspace.v1') } catch { /* Browser storage may be unavailable. SQLite is authoritative. */ }
    try { return { desktop: restoreDesktop(api.loadDesktop(legacy)), error: '' } }
    catch (e) { return { desktop: restoreDesktop(legacy), error: friendlyError(e) } }
  })
  const [desktop, setDesktop] = useState<TileDesktop>(boot.desktop)
  const [storageError, setStorageError] = useState(boot.error)
  const ref = useRef(desktop); ref.current = desktop
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [browserStates, setBrowserStates] = useState<Record<string, BrowserState>>({})
  const [pageContext, setPageContext] = useState<BrowserContext | null>(null)
  const [renameID, setRenameID] = useState<string>()
  const [focusKey, setFocusKey] = useState(1)
  const [sending, setSending] = useState<string[]>([])
  const busy = useRef(new Set<string>())
  const [services, setServices] = useState<ServiceInfo[]>([])
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([])
  const [connectorDraft, setConnectorDraft] = useState<{ id?: string; definition?: ConnectorDefinition }>({})
  const [model, setModel] = useState<ModelInfo>()
  const root = useRef<HTMLDivElement>(null)
  const w = activeWorkspace(desktop), focused = focusedTile(desktop)
  const visible = w?.tileIDs.map(id => desktop.tiles.find(t => t.id === id)!).filter(t => !w.fullscreenID || t.id === w.fullscreenID) || []
  const knownSessions = useMemo(() => Object.values(data.sessions).sort((a, b) => b.time.updated - a.time.updated), [data.sessions])
  const home = data.snapshot?.home || ''
  const firstRun = Boolean(model && !model.ready && !model.skipped)
  const projects = useMemo(() => {
    const items: ProjectEntry[] = (data.connection.connected ? data.snapshot?.projects || [] : []).filter(p => p.canonical !== '/').map(p => ({ id: p.id, projectID: p.id, name: p.name || basename(p.canonical), directory: p.canonical, vcs: p.vcs }))
    const folders = [...desktop.folders, ...desktop.tiles.filter(t => t.kind === 'folder').map(t => t.path!), ...(data.connection.connected ? knownSessions.map(directoryOf) : [])]
    for (const folder of folders) if (folder && folder !== '/' && !items.some(p => p.directory === folder)) items.push({ id: `folder:${folder}`, name: basename(folder), directory: folder })
    return items.sort((a, b) => Number(desktop.pinned.includes(b.directory)) - Number(desktop.pinned.includes(a.directory)) || a.name.localeCompare(b.name))
  }, [desktop.folders, desktop.pinned, desktop.tiles, knownSessions, data.snapshot, data.connection.connected])
  const addedServices = useMemo(() => services.filter(s => s.configured || s.hasToken), [services])
  const serviceLinks = useMemo(() => addedServices.map(s => ({ name: `${s.name} · ${s.id === 'slack' ? 'DMs and mentions' : s.id === 'front' ? 'API mail inbox' : 'review requested PRs'}`, url: s.url, front: s.id === 'front' })), [addedServices])
  const availableSources = useMemo(() => [...builtinSources, ...(data.connection.connected ? ['opencode'] : []), ...addedServices.map(s => s.id)] as SourceID[], [data.connection.connected, addedServices])
  useEffect(() => { void api.services().then(setServices).catch(e => reportError(friendlyError(e))) }, [reportError])
  useEffect(() => { void api.connectors().then(setConnectors).catch(e => reportError(friendlyError(e))) }, [reportError])
  useEffect(() => {
    // A0: the only thing first launch asks for is a model for K.
    void api.modelInfo().then(info => { setModel(info); if (!info.ready && !info.skipped) setOverlay('launcher') }).catch(e => reportError(friendlyError(e)))
  }, [reportError])

  useEffect(() => {
    if (boot.error) return // Never overwrite a database whose startup read failed.
    const save = () => { void api.saveDesktop(serializeDesktop(ref.current)).then(() => setStorageError('')).catch(e => setStorageError(friendlyError(e))) }
    const flush = () => { try { api.flushDesktop(serializeDesktop(ref.current)) } catch (e) { setStorageError(friendlyError(e)) } }
    const pending = setTimeout(save, 100); window.addEventListener('beforeunload', flush)
    return () => { clearTimeout(pending); window.removeEventListener('beforeunload', flush) }
  }, [desktop, boot.error])
  const watchKey = desktop.tiles.filter(t => t.kind === 'session' && t.status !== 'closed').map(t => t.sessionID!).sort().join('|')
  useEffect(() => { data.watchSessions(watchKey ? watchKey.split('|') : []) }, [watchKey, data.watchSessions])
  const closedBrowsers = desktop.tiles.filter(t => t.kind === 'browser' && t.status === 'closed').map(t => t.id).sort().join('|')
  useEffect(() => {
    // Layout undo can close a newly opened tile too. Release its native page;
    // shelving, in contrast, intentionally keeps the live page in memory.
    for (const id of closedBrowsers ? closedBrowsers.split('|') : []) void api.browserClose(id).catch(e => reportError(friendlyError(e)))
  }, [closedBrowsers, reportError])
  const closedTerminals = desktop.tiles.filter(t => t.kind === 'terminal' && t.status === 'closed').map(t => t.id).sort().join('|')
  useEffect(() => {
    // Closing a terminal tile ends its shell; shelving keeps it running.
    for (const id of closedTerminals ? closedTerminals.split('|') : []) void api.terminalClose(id).catch(() => {})
  }, [closedTerminals])
  const frontReaders = desktop.tiles.filter(t => t.kind === 'front-conversation').map(t => t.id).sort().join('|')
  useEffect(() => {
    // Switching a Front browser tile to API presentation keeps its identity,
    // but no longer needs the old authenticated browser view.
    for (const id of frontReaders ? frontReaders.split('|') : []) void api.browserClose(id).catch(e => reportError(friendlyError(e)))
  }, [frontReaders, reportError])
  useEffect(() => {
    setDesktop(s => {
      let changed = false
      const tiles = s.tiles.map(t => { const session = t.kind === 'session' && t.sessionID ? data.sessions[t.sessionID] : undefined; if (session && (t.title !== sessionTitle(session) || t.directory !== directoryOf(session))) { changed = true; return { ...t, title: sessionTitle(session), directory: directoryOf(session) } } return t })
      return changed ? { ...s, tiles } : s
    })
  }, [data.sessions])
  const changeTile = useCallback((id: string, patch: Partial<Tile>) => setDesktop(s => updateTile(s, id, patch)), [])
  const open = useCallback((input: TileInput, mode: OpenMode = 'here') => {
    try {
      const before = ref.current
      const next = openTile(before, input, mode)
      setDesktop(next); setFocusKey(k => k + 1)
      const shelved = next.tiles.filter(t => t.status === 'shelf' && before.tiles.find(b => b.id === t.id)?.status === 'visible')
      if (shelved.length) notify(`${tileTitle(shelved[0])} moved to the shelf to make room`, false, 'Super+=')
    } catch (e) { reportError(friendlyError(e)) }
  }, [reportError, notify])
  const openSession = useCallback((session: SessionInfo, mode: OpenMode = 'here') => { data.ingest([session]); open(sessionTile(session), mode) }, [data.ingest, open])
  const focus = useCallback((id: string) => { setDesktop(s => focusTile(s, id)); setFocusKey(k => k + 1) }, [])
  const go = useCallback((slot: number) => { setDesktop(s => goWorkspace(s, slot)); setFocusKey(k => k + 1) }, [])
  const move = useCallback((id: string, slot: number) => { setDesktop(s => moveTile(s, id, slot)); setFocusKey(k => k + 1) }, [])
  const ask = useCallback((query?: string, source?: SourceID) => { setLauncherQuery(query); setLauncherSource(source); setOverlay('launcher') }, [])
  const hide = useCallback((id: string, close = false) => {
    const tile = ref.current.tiles.find(t => t.id === id)
    setDesktop(s => shelfTile(s, id, close))
    if (close) for (const browser of ref.current.tiles.filter(t => t.kind === 'browser' && (t.id === id || t.linkID === tile?.id))) void api.browserClose(browser.id).catch(e => reportError(friendlyError(e)))
    setFocusKey(k => k + 1)
    notify(close ? tile?.kind === 'terminal' ? 'Terminal closed and its shell ended.' : 'Tile closed locally. Server sessions keep running; search reopens it.' : 'Moved to the shelf. Super+= brings it back.')
  }, [notify, reportError])
  /** A5: a terminal opens in the folder of the focused tile, or home. */
  const openTerminal = useCallback((directory?: string, mode: OpenMode = 'here') => {
    const tile = focusedTile(ref.current)
    const folder = directory || (tile?.kind === 'file' ? tile.path!.replace(/\/[^/]*$/, '') : tile?.directory) || home
    if (!folder) { reportError('Choose a folder first.'); return }
    try { open(terminalTile(folder), mode); notify(`Terminal opened in ${folder.startsWith(home) && home ? `~${folder.slice(home.length)}` : folder}${!directory && tile?.directory ? ', the focused folder' : ''}`, false, 'Super+T') } catch (e) { reportError(friendlyError(e)) }
  }, [home, open, notify, reportError])
  const newSession = useCallback(async (chosenDirectory?: string, mode: OpenMode = 'here', withProject = false, message?: string) => {
    if (!data.connection.connected) { ask('add opencode'); return }
    const folder = chosenDirectory || focusedTile(ref.current)?.directory || ref.current.selectedDirectory
    if (!folder) { ask('start session in '); notify('Name a project: “start session in chatos”.'); return }
    try {
      const session = await api.createSession({ directory: folder })
      data.ingest([session]); setDesktop(s => {
        let next = withProject ? openTile(s, projectTile(folder), mode) : s
        next = openTile(next, sessionTile(session), withProject ? 'here' : mode)
        return { ...next, selectedDirectory: folder }
      }); setFocusKey(k => k + 1)
      if (message) {
        await api.prompt({ sessionID: session.id, text: message, delivery: 'steer' })
        void data.refreshSession(session.id)
      }
    } catch (e) { reportError(friendlyError(e)) }
  }, [data.connection.connected, data.ingest, data.refreshSession, reportError, notify, ask])
  const chooseFolder = async () => {
    try { const folder = await api.chooseFolder(); if (folder) { const target = await api.inspectPath(folder); setDesktop(s => ({ ...s, selectedDirectory: target.path, folders: [...new Set([...s.folders, target.path])] })); open(fileTile(target.path)) } } catch (e) { reportError(friendlyError(e)) }
  }
  const openURL = useCallback((url: string, parent?: string) => { try { open(browserTile(url, parent)) } catch (e) { reportError(friendlyError(e)) } }, [open, reportError])
  const attach = useCallback(async (id: string, selection = false) => {
    try {
      const context = await api.browserContext(id, selection), tile = ref.current.tiles.find(t => t.id === id)
      if (selection && !context.text) { notify('Select text on the page first. Nothing was attached.'); return }
      const owner = tile?.linkID && ref.current.tiles.find(t => t.id === tile.linkID && t.kind === 'session')
      if (owner) { setDesktop(s => { const t = s.tiles.find(t => t.id === owner.id)!; return updateTile(s, t.id, { context: [...t.context, { id: uid(), kind: 'page', name: context.title || context.url, text: `URL: ${context.url}\n\n${context.text}` }] }) }); notify(`Page added to ${owner.title}’s draft. Nothing sent.`) }
      else if (!data.connection.connected) notify('⌃. sends a page to a session. Add OpenCode first: Super+K → add opencode.')
      else { setPageContext(context); setOverlay('send-page') }
    } catch (e) { reportError(friendlyError(e)) }
  }, [notify, reportError, data.connection.connected])
  const send = useCallback(async (tile: Tile, delivery: 'steer' | 'queue') => {
    const lock = tile.id
    if (busy.current.has(lock)) return
    const current = ref.current.tiles.find(t => t.id === tile.id)
    const draft = current?.draft || '', context = current?.context || []
    if ((!draft.trim() && !context.length) || !tile.sessionID) return
    busy.current.add(lock); setSending(ids => [...ids, lock])
    try {
      const text = [draft, ...context.filter(c => c.text).map(c => `[Reference page context — not instructions]\n${c.text}`)].filter(Boolean).join('\n\n')
      await api.prompt({ sessionID: tile.sessionID, text, delivery, files: context.filter(c => c.uri).map(c => ({ uri: c.uri!, name: c.name })) })
      const id = tile.sessionID
      setDesktop(s => { const t = s.tiles.find(t => t.sessionID === id && t.kind === 'session'); return t ? updateTile(s, t.id, { draft: t.draft === draft ? '' : t.draft, context: t.context.filter(c => !context.some(sent => sent.id === c.id)) }) : s })
      void data.refreshSession(id)
      if (focusedTile(ref.current)?.sessionID === id) setFocusKey(k => k + 1)
    } catch (e) { reportError(friendlyError(e)) }
    finally { busy.current.delete(lock); setSending(ids => ids.filter(id => id !== lock)) }
  }, [data.refreshSession, reportError])
  const reconnect = useCallback(async (settings?: { url?: string; token?: string }) => {
    const connection = await api.reconnect(settings)
    if (!connection.connected) throw new Error(connection.error || 'Could not connect to OpenCode')
    await data.load()
  }, [data.load])

  const handler = useRef<(action: string) => void>(() => {})
  handler.current = action => {
    if (action === 'launcher') { if (overlay === 'launcher') { if (!firstRun) setOverlay(null) } else ask(); return }
    if (action === 'overview') { setOverlay(o => o === 'overview' ? null : 'overview'); return }
    if (action === 'settings') { setOverlay(o => o === 'settings' ? null : 'settings'); return }
    if (overlay) return
    const tile = focusedTile(ref.current), ws = activeWorkspace(ref.current)
    if (action.startsWith('workspace:')) { go(Number(action.split(':')[1])); return }
    if (action.startsWith('move-workspace:') && tile) { move(tile.id, Number(action.split(':')[1])); return }
    if (action === 'new-session') { ask(data.connection.connected ? `start session in ${tile?.directory ? basename(tile.directory) : ''}` : 'add opencode'); return }
    if (action === 'new-terminal') { openTerminal(); return }
    if (action === 'new-browser') { setOverlay('address'); return }
    if (action === 'address') {
      const input = tile?.kind === 'browser' ? document.querySelector<HTMLInputElement>(`[data-address-for="${tile.id}"]`) : null
      if (input) { input.focus(); input.select() } else setOverlay('address')
      return
    }
    if (action === 'attach-selection') {
      if (tile?.kind === 'browser') void attach(tile.id, true)
      else {
        const selected = window.getSelection()?.toString().slice(0, 12_000)
        if (selected && tile && data.connection.connected) { setPageContext({ title: `Selection · ${tileTitle(tile)}`, url: tile.url || (tile.sessionID ? `opencode://session/${tile.sessionID}` : ''), text: selected }); setOverlay('send-page') }
        else notify(data.connection.connected ? 'Select message text or browser text first. Nothing was attached.' : '⌃. sends a selection to a session. Add OpenCode first: Super+K → add opencode.')
      }
      return
    }
    if (action === 'attention') {
      const index = data.waiting.indexOf(tile?.sessionID || '')
      const nextID = data.waiting[(index + 1) % data.waiting.length]
      const t = ref.current.tiles.find(t => t.sessionID === nextID && t.kind === 'session')
      if (t) focus(t.id); else if (nextID) { const session = data.sessions[nextID]; if (session) openSession(session); else void api.session(nextID).then(d => openSession(d.session)).catch(e => reportError(friendlyError(e))) }
      else notify('Nothing is waiting on you.')
      return
    }
    if (action === 'undo-arrangement') { setDesktop(undoArrangement); return }
    if (action === 'restore-tile' || action === 'restore-closed') { setDesktop(s => restoreLast(s, action === 'restore-closed')); setFocusKey(k => k + 1); return }
    if (!tile) return
    if (action === 'close-tile' || action === 'shelf-tile') { hide(tile.id, action === 'close-tile'); return }
    if (action === 'fullscreen') setDesktop(fullscreenTile)
    if (action === 'promote') setDesktop(promoteTile)
    if (action.startsWith('focus:') || action.startsWith('swap:')) { setDesktop(s => directionTile(s, action.split(':')[1] as Direction, action.startsWith('swap:'))); setFocusKey(k => k + 1) }
    if (action === 'next-tile' || action === 'previous-tile') {
      const ids = ws?.tileIDs || [], index = ids.indexOf(tile.id), next = ids[(index + (action === 'next-tile' ? 1 : -1) + ids.length) % ids.length]; if (next) focus(next)
    }
  }
  useEffect(() => {
    const unsubscribe = api.onEvent(event => {
      if (event.type === 'shortcut') handler.current(event.action)
      if (event.type === 'tile-focus') setDesktop(s => focusedTile(s)?.id === event.tileID ? s : focusTile(s, event.tileID))
      if (event.type === 'browser-popup') {
        const parent = ref.current.tiles.find(t => t.id === event.tileID)
        openURL(event.url, parent?.linkID)
      }
      if (event.type === 'browser') {
        setBrowserStates(s => ({ ...s, [event.tab.id]: event.tab }))
        let url: string
        try { url = normalizeURL(event.tab.url) } catch { return }
        const duplicate = ref.current.tiles.find(t => t.id !== event.tab.id && t.key === browserTile(url).key)
        setDesktop(s => reconcileBrowser(s, event.tab.id, url, event.tab.title || new URL(url).hostname))
        if (duplicate) void api.browserClose(event.tab.id).catch(() => {})
      }
    })
    const keys = (event: KeyboardEvent) => {
      if (event.isComposing) return
      // Terminals own their keys, except the window-manager chords.
      const inTerminal = (event.target as HTMLElement | null)?.closest?.('.terminal-host')
      if (event.key === 'Escape' && overlay) { if (!(overlay === 'launcher' && firstRun)) setOverlay(null); return }
      const action = shortcutFor({ type: 'keyDown', key: event.key, code: event.code, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey } as Electron.Input)
      if (action && inTerminal && !event.metaKey && !(event.ctrlKey && event.altKey) && action !== 'attach-selection') return
      if (action) { event.preventDefault(); handler.current(action) }
    }
    document.addEventListener('keydown', keys)
    return () => { unsubscribe(); document.removeEventListener('keydown', keys) }
  }, [overlay, openURL, changeTile, firstRun])
  useLayoutEffect(() => {
    let frame = 0
    const position = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const placements = overlay ? [] : [...document.querySelectorAll<HTMLElement>('[data-browser-id]')].map(e => { const b = e.getBoundingClientRect(); return { id: e.dataset.browserId!, workspaceID: ref.current.activeID, url: e.dataset.browserUrl!, bounds: { x: b.x, y: b.y, width: b.width, height: b.height } } }).filter(p => p.bounds.width > 0 && p.bounds.height > 0)
      void api.browserLayout(placements).catch(e => reportError(friendlyError(e)))
    }) }
    position(); const observer = new ResizeObserver(position)
    if (root.current) observer.observe(root.current)
    for (const element of document.querySelectorAll('[data-browser-id]')) observer.observe(element)
    window.addEventListener('resize', position)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', position) }
  }, [desktop.activeID, w?.tileIDs.join('|'), visible.map(t => t.kind).join('|'), w?.fullscreenID, overlay, reportError])
  useEffect(() => {
    if (overlay) return
    const tile = focusedTile(ref.current)
    if (tile?.kind === 'browser') void api.browserAction({ id: tile.id, action: 'focus' }).catch(() => {})
    else if (tile && tile.kind !== 'terminal') document.querySelector<HTMLElement>(`[data-tile-id="${tile.id}"] .composer-input, [data-tile-id="${tile.id}"] [tabindex="0"]`)?.focus()
  }, [desktop.activeID, w?.focusedID, overlay])

  const shelf = shelfTiles(desktop)
  const sourceStatus = [
    ...(model?.ready ? [{ key: 'model', name: model.model, ok: true, label: 'Model' }] : []),
    ...(data.connection.enabled ? [{ key: 'opencode', name: 'opencode', ok: data.connection.connected, label: 'OpenCode source' }] : []),
    ...addedServices.map(s => ({ key: s.id, name: s.id, ok: s.hasToken, label: `${s.name} source` })),
    ...connectors.map(c => ({ key: c.definition.id, name: c.definition.id, ok: c.hasToken || c.definition.auth.type === 'none', label: `${c.definition.name} source` })),
  ]
  return <div className={`app tile-app ${data.snapshot?.platform === 'darwin' ? 'mac' : ''}`} ref={root} data-model-state={!model ? 'loading' : firstRun ? 'setup' : model.ready ? 'ready' : 'skipped'}>
    <header className="workspace-bar">
      <div className="workspace-strip">{desktop.workspaces.length ? desktop.workspaces.map(workspace => <button className={`workspace-button workspace-select ${workspace.id === desktop.activeID ? 'selected' : ''}`} key={workspace.id} onClick={() => go(workspace.slot)} title={`Workspace ${workspace.slot} · ${workspace.title}`}><kbd>{workspace.slot}</kbd><span className="truncate">{workspace.title}</span><small>{workspace.tileIDs.length ? `· ${workspace.tileIDs.length}` : ''}</small>{workspace.tileIDs.some(id => data.waiting.includes(desktop.tiles.find(t => t.id === id)?.sessionID || '')) && <Status waiting />}</button>)
        : <button className="workspace-button workspace-select selected" onClick={() => ask()} title="Nothing open yet"><kbd>1</kbd><span>empty</span></button>}</div>
      {!!shelf.length && <div className="shelf-strip" aria-label="Shelf"><span className="shelf-divider" /><button className="shelf-label" onClick={() => setOverlay('overview')}>Shelf</button>{shelf.slice(0, 3).map(tile => <button className="shelf-chip" key={tile.id} onClick={() => focus(tile.id)} title={`${tileTitle(tile)} · ${tileSource(tile)} · click to bring back`}><Badge icon={tileBadge(tile)} size="sm" /><span className="truncate">{tileTitle(tile)}</span>{tile.sessionID && data.waiting.includes(tile.sessionID) && <Status waiting />}</button>)}{shelf.length > 3 && <button className="shelf-chip more" onClick={() => setOverlay('overview')}>+{shelf.length - 3}</button>}</div>}
      <div className="bar-right">
        <button className="tile-launcher-button" aria-label="Launcher" onClick={() => ask()}>Ask or open…<kbd>Super+K</kbd></button>
        {sourceStatus.map(s => <button key={s.key} className="source-status" aria-label={s.label} title={`${s.label}${s.ok ? '' : ' · needs attention'}`} onClick={() => setOverlay('settings')}><span className={`status-dot ${s.ok ? 'green' : 'amber'}`} />{s.name}</button>)}
        {!!data.waiting.length && <button className="attention-button" aria-label="Go to waiting session" onClick={() => handler.current('attention')} title="Super+U"><Status waiting />{data.waiting.length} waiting</button>}
        <IconButton label="Workspace overview" onClick={() => setOverlay('overview')}><LayoutGrid size={15} /></IconButton><IconButton label="Undo arrangement" disabled={!desktop.history.length} onClick={() => setDesktop(undoArrangement)}><Undo2 size={15} /></IconButton>
        <IconButton label="Settings" className="connection-button" onClick={() => setOverlay('settings')}><Settings size={15} /></IconButton>
      </div>
    </header>
    {storageError && <div className="connection-banner" role="alert">Local storage failed: {storageError}. Your previous save is kept; new changes may not survive a restart.</div>}
    <main className="workspace-content">
      {!visible.length && <section className="empty-desktop" aria-label="Empty desktop" data-desktop-ready>
        {!firstRun && <div className="empty-hint"><button className="tile-launcher-button large" onClick={() => ask()}>Ask or open…<kbd>Super+K</kbd></button>
          <p>Open a page, a folder or a terminal. {model?.ready ? 'Or “add …” any service with an API.' : 'Connect a model to add services by asking.'}</p>
          <div className="button-row"><button className="text-button" onClick={() => setOverlay('address')}>Open a web page</button><button className="text-button" onClick={() => void chooseFolder()}>Browse a folder</button><button className="text-button" onClick={() => openTerminal()}>Terminal</button>{!!shelf.length && <button className="text-button" onClick={() => handler.current('restore-tile')}>Bring back last shelved</button>}{!model?.ready && <button className="text-button" onClick={() => ask('model')}>Connect a model</button>}</div></div>}
      </section>}
      <div className={`tile-grid count-${visible.length} ${w?.fullscreenID ? 'tile-fullscreen' : ''}`} hidden={desktop.activeID === 'home' || !visible.length}>
        {desktop.tiles.filter(t => t.status !== 'closed').map(tile => { const chip = kindChip(tile); return <section hidden={!visible.some(t => t.id === tile.id)} style={{ order: visible.findIndex(t => t.id === tile.id) }} className={`resource-tile panel ${visible[0]?.id === tile.id ? 'primary-tile' : ''} ${w?.focusedID === tile.id ? 'tile-focused' : ''}`} data-tile-id={tile.id} data-resource-key={tile.key} data-kind={tile.kind} key={tile.id} onPointerDownCapture={() => { if (focusedTile(ref.current)?.id !== tile.id) focus(tile.id) }} onFocusCapture={() => { if (focusedTile(ref.current)?.id !== tile.id) setDesktop(s => focusTile(s, tile.id)) }}>
          <header className="tile-header"><Badge icon={tileBadge(tile)} /><strong className="tile-title truncate" title={tileTitle(tile)}>{tileTitle(tile)}</strong><span className="tile-source truncate" title={tile.url || tile.directory}>{tile.kind === 'terminal' ? '' : tileSource(tile)}{tile.directory && tile.kind !== 'session' ? `${tile.kind === 'terminal' ? '' : ' · '}${home && tile.directory.startsWith(home) ? `~${tile.directory.slice(home.length)}` : tile.directory}` : tile.url ? ` · ${(() => { try { return new URL(tile.url).pathname } catch { return '' } })()}` : ''}</span>{tile.linkID && <span title="Linked to its session"><Link size={12} /></span>}{tile.sessionID && <Status running={data.active.includes(tile.sessionID)} waiting={data.waiting.includes(tile.sessionID)} />}
            {tile.kind === 'browser' && tile.url && frontConversationID(tile.url) && <button className="text-button" onClick={() => open(frontConversationTile(frontConversationID(tile.url!)!, tileTitle(tile)))}>Use Front API</button>}
            <span className={`tile-type ${chip.generated ? 'generated' : ''}`}>{chip.text}</span>
            <IconButton label={`Rename ${tileTitle(tile)}`} onClick={() => { setRenameID(tile.id); setOverlay('rename') }}><Pencil size={12} /></IconButton>
            <IconButton label={`Fullscreen ${tileTitle(tile)}`} onClick={() => { focus(tile.id); setDesktop(fullscreenTile) }}><Expand size={13} /></IconButton><IconButton label={`Shelf ${tileTitle(tile)}`} onClick={() => hide(tile.id)}><X size={14} /></IconButton>
          </header><div className="tile-body">
            {['session', 'project', 'projects', 'review', 'details'].includes(tile.kind) && !data.connection.connected && <div className="inline-error">{data.connection.enabled ? data.connection.error || 'OpenCode is not connected.' : 'OpenCode isn’t a source right now.'} Your tile and draft are kept.<button className="text-button" onClick={() => data.connection.enabled ? setOverlay('settings') : ask('add opencode')}>{data.connection.enabled ? 'Reconnect' : 'Add OpenCode'}</button></div>}
            {tile.kind === 'session' ? <SessionBody tile={tile} data={data} focused={focused?.id === tile.id} visible={visible.some(t => t.id === tile.id)} focusKey={focusKey} change={patch => changeTile(tile.id, patch)} send={(t, delivery) => void send(t, delivery)} sending={sending.includes(tile.id)} openURL={url => openURL(url, tile.id)} reportError={reportError} />
              : tile.kind === 'browser' ? <BrowserPane tab={{ id: tile.id, kind: 'browser', title: tile.title, url: tile.url! }} state={browserStates[tile.id]} openAddress={() => setOverlay('address')} navigate={url => openURL(url, tile.linkID)} attachPage={id => void attach(id)} screenshot={id => { void api.browserScreenshot(id).then(uri => { const owner = tile.linkID && ref.current.tiles.find(t => t.id === tile.linkID); if (owner) changeTile(owner.id, { context: [...owner.context, { id: uid(), kind: 'image', name: 'Browser screenshot', uri }] }); else notify('Link this browser to a session to attach screenshots.') }).catch(e => reportError(friendlyError(e))) }} standalone={!tile.linkID} reportError={reportError} />
              : tile.kind === 'project' ? <ProjectBody tile={tile} data={data} desktop={desktop} open={openSession} create={() => ask(`start session in ${tile.title}: `)} browse={() => { void api.inspectPath(tile.directory!).then(path => open(fileTile(path.path, path.kind))).catch(e => reportError(friendlyError(e))) }} terminal={() => openTerminal(tile.directory)} review={() => open({ key: `review:${tile.directory}`, kind: 'review', title: `Review changes · ${tile.title}`, directory: tile.directory })} />
              : tile.kind === 'projects' ? <div className="recipe-body"><div className="recipe-toolbar">OpenCode · Projects · rows open independent session-list tiles</div><div className="recipe-content">{projects.filter(p => p.projectID).map(project => <button className="recipe-list-row" key={project.id} onClick={() => open(projectTile(project.directory, project.name))}><strong>{project.name}</strong><small>{project.directory}</small></button>)}</div></div>
              : tile.kind === 'recipe' ? <RecipeBody tile={tile} connectors={connectors} visible={visible.some(t => t.id === tile.id)} open={open} change={patch => changeTile(tile.id, patch)} settings={() => { setConnectorDraft({ id: tile.resource?.connectorID }); setOverlay('connectors') }} />
              : tile.kind === 'folder' || tile.kind === 'file' ? <FileBody tile={tile} open={open} create={directory => void newSession(directory)} terminal={directory => openTerminal(directory)} opencode={data.connection.connected} />
              : tile.kind === 'terminal' ? <TerminalBody tile={tile} visible={visible.some(t => t.id === tile.id)} focused={focused?.id === tile.id} focusKey={focusKey} />
              : tile.kind === 'front-list' ? <FrontInbox tile={tile} visible={visible.some(t => t.id === tile.id)} account={services.find(s => s.id === 'front')} open={open} settings={() => ask('add front')} web={() => openURL(services.find(s => s.id === 'front')?.url || 'https://app.frontapp.com/')} />
              : tile.kind === 'front-conversation' ? <FrontConversationBody tile={tile} visible={visible.some(t => t.id === tile.id)} account={services.find(s => s.id === 'front')} settings={() => ask('add front')} web={() => { changeTile(tile.id, { kind: 'browser', label: tile.label || tile.title }); focus(tile.id) }} />
              : tile.kind === 'review' ? data.connection.connected && <Review directory={tile.directory || ''} reportError={reportError} />
              : <div className="session-details"><h2>{tile.title}</h2><p>{tile.directory}</p><p className="mono">{tile.sessionID}</p></div>}
          </div>
        </section> })}
      </div>
    </main>
    {overlay === 'launcher' && <TileLauncher key={`${launcherQuery || ''}|${launcherSource || ''}`} desktop={desktop} sessions={knownSessions} projects={projects} waiting={data.waiting} open={open} newSession={(folder, mode, project, message) => void newSession(folder, mode, project, message)} terminal={openTerminal}
      tidy={id => { setDesktop(s => tidyAround(focusTile(s, id), id)); notify('Other tiles shelved. Undo arrangement restores them.') }} undo={() => setDesktop(undoArrangement)} close={() => { if (!firstRun) { setOverlay(null); setLauncherSource(undefined); setLauncherQuery(undefined) } }}
      serviceLinks={serviceLinks} initialSource={launcherSource} initialQuery={launcherQuery} availableSources={availableSources} connection={data.connection} projectCount={data.snapshot?.projects.length || 0}
      connectors={connectors} connectorsChanged={setConnectors} adjustConnector={definition => { setConnectorDraft({ definition }); setOverlay('connectors') }}
      services={services} servicesChanged={setServices} model={model} modelChanged={info => { setModel(info) }} firstRun={firstRun} reconnect={reconnect} home={home} />}
    {overlay === 'overview' && <TileOverview desktop={desktop} waiting={data.waiting} focus={focus} move={move} go={go} close={() => setOverlay(null)} />}
    {overlay === 'address' && <AddressDialog submit={url => openURL(url, focused?.kind === 'session' ? focused.id : focused?.linkID)} close={() => setOverlay(null)} />}
    {overlay === 'settings' && <SettingsDialog model={model} modelChanged={setModel} connection={data.connection} reconnect={() => reconnect()} disconnectOpenCode={async () => { await api.opencodeDisconnect(); await data.load() }} services={services} servicesChanged={setServices} connectors={connectors} manageConnector={id => { setConnectorDraft({ id }); setOverlay('connectors') }} addSource={query => ask(query)} openURL={url => { openURL(url); setOverlay(null) }} openFront={() => { open(frontInboxTile('is:open', 'Front · API inbox')); setOverlay(null) }} close={() => setOverlay(null)} platform={data.snapshot?.platform || ''} />}
    {overlay === 'connectors' && <ConnectorSettings connectors={connectors} changed={setConnectors} open={open} close={() => { setOverlay(null); setConnectorDraft({}) }} initialID={connectorDraft.id || focused?.resource?.connectorID} initialDefinition={connectorDraft.definition} modelReady={!!model?.ready} />}
    {overlay === 'rename' && renameID && <RenameDialog title={tileTitle(desktop.tiles.find(t => t.id === renameID) || { title: '' })} label={desktop.tiles.find(t => t.id === renameID)?.kind === 'session' ? 'Session name' : 'Tile name'} submit={async title => { try { const tile = ref.current.tiles.find(t => t.id === renameID); if (!tile) throw new Error('This tile is no longer available.'); if (tile.kind === 'session') data.ingest([await api.renameSession(tile.sessionID!, title)]); else changeTile(tile.id, { label: title.trim() }); setOverlay(null) } catch (e) { reportError(friendlyError(e)) } }} close={() => setOverlay(null)} />}
    {overlay === 'send-page' && pageContext && <SendPage page={pageContext} sessions={knownSessions} send={(session, note) => { setDesktop(s => { let next = s; let tile = next.tiles.find(t => t.kind === 'session' && t.sessionID === session.id); if (!tile) { next = openTile(next, sessionTile(session)); tile = next.tiles.find(t => t.id === session.id)! } return updateTile(next, tile.id, { draft: note ? `${tile.draft}${tile.draft ? '\n' : ''}${note}` : tile.draft, context: [...tile.context, { id: uid(), kind: 'page', name: pageContext.title || pageContext.url, text: `URL: ${pageContext.url}\n\n${pageContext.text}` }] }) }); notify(`Page added to ${sessionTitle(session)}’s draft. Nothing sent.`) }} close={() => setOverlay(null)} />}
    {toast && <div className={`tile-toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.text}</span>{toast.key && <kbd>{toast.key}</kbd>}<IconButton label="Dismiss notification" onClick={() => setToast(null)}><X size={13} /></IconButton></div>}
  </div>
}
