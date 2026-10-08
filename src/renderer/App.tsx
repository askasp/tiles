import { Expand, LayoutGrid, Link, Pencil, Settings, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { BrowserContext } from '../shared/types'
import type { ModelInfo } from '../shared/model'
import type { ConnectorDefinition, ConnectorInfo } from '../shared/connectors'
import { createShortcutReader, shortcutFor } from '../shared/shortcuts'
import { activeWorkspace, browserTile, directionTile, fileTile, focusTile, focusedTile, fullscreenTile, goWorkspace, moveTile, openTile, promoteTile, replaceTile, restoreLast, serializeDesktop, shelfTile, shelfTiles, terminalTile, tidyAround, tileTitle, undoArrangement, updateTile, type Direction, type OpenMode, type Tile, type TileDesktop, type TileInput } from '../shared/tiles'
import { resourceSource, sources as catalogue, type SourceID } from '../shared/sources'
import { restore } from '../shared/registry'
import { uid } from '../shared/util'
import { AddressDialog, RenameDialog, SendPage, Settings as SettingsDialog } from './Overlays'
import { Badge, TileLauncher, TileOverview, tileBadge, tileSource } from './TileOverlays'
import { api, friendlyError } from './data'
import { IconButton, KeyButton, Status, listKeys, rowSelector } from './ui'
import { ConnectorSettings } from './ConnectorSettings'
import { registry, sourceFor } from './sources/registry'
import type { Env } from './sources/types'

const STORAGE = 'chatos.desktop.v2'
type Overlay = 'launcher' | 'address' | 'overview' | 'settings' | 'connectors' | 'rename' | 'send-page' | null

const kindChip = (tile: Tile, connectors: ConnectorInfo[]) => {
  const owner = catalogue.find(s => s.id === resourceSource(tile) || `connector:${s.id}` === resourceSource(tile))
  const kind = ({ browser: 'page', folder: 'folder', file: 'file', terminal: 'shell', recipe: tile.resource?.resourceID ? 'item' : 'list' } as Record<string, string>)[tile.kind] || tile.kind
  // Front, Slack and GitHub connectors ship with ChatOS; the rest K generated.
  const generated = tile.kind === 'recipe' && !connectors.find(c => c.definition.id === tile.resource?.connectorID)?.builtin
  return { text: `${(tile.kind === 'recipe' ? tile.sourceName || 'connector' : owner?.name || 'browser').toLowerCase()} · ${kind} · ${generated ? 'generated' : 'built-in'}`, generated }
}

export default function App() {
  const [launcher, setLauncher] = useState<{ query?: string; source?: SourceID }>({})
  const [toast, setToast] = useState<{ text: string; error?: boolean; key?: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notify = useCallback((text: string, error = false, key?: string) => { setToast({ text, error, key }); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), error ? 8_000 : 4_000) }, [])
  const reportError = useCallback((text: string) => notify(text, true), [notify])
  const [boot] = useState(() => {
    let legacy: string | null = null
    try { legacy = localStorage.getItem(STORAGE) || localStorage.getItem('chatos.workspace.v1') } catch { /* Browser storage may be unavailable. SQLite is authoritative. */ }
    try { return { desktop: restore(api.loadDesktop(legacy)), error: '' } }
    catch (e) { return { desktop: restore(legacy), error: friendlyError(e) } }
  })
  const [desktop, setDesktop] = useState<TileDesktop>(boot.desktop)
  const [storageError, setStorageError] = useState(boot.error)
  const ref = useRef(desktop); ref.current = desktop
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [pageContext, setPageContext] = useState<BrowserContext | null>(null)
  const [renameID, setRenameID] = useState<string>()
  const [focusKey, setFocusKey] = useState(1)
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([])
  const [connectorDraft, setConnectorDraft] = useState<{ id?: string; definition?: ConnectorDefinition }>({})
  const [model, setModel] = useState<ModelInfo>()
  const [machine, setMachine] = useState({ home: '', platform: '' })
  const [chord, setChord] = useState(false)
  const chordTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const home = machine.home
  const root = useRef<HTMLDivElement>(null)
  const w = activeWorkspace(desktop), focused = focusedTile(desktop)
  const visible = w?.tileIDs.map(id => desktop.tiles.find(t => t.id === id)!).filter(t => !w.fullscreenID || t.id === w.fullscreenID) || []
  const firstRun = Boolean(model && !model.configured && !model.skipped)
  const firstRunRef = useRef(firstRun); firstRunRef.current = firstRun
  useEffect(() => { void api.connectors().then(setConnectors).catch(e => reportError(friendlyError(e))) }, [reportError])
  useEffect(() => { void api.environment().then(setMachine).catch(() => {}) }, [])
  useEffect(() => {
    // A0: the only thing first launch asks for is a model for K.
    void api.modelInfo().then(info => { setModel(info); if (!info.configured && !info.skipped) setOverlay('launcher') }).catch(e => reportError(friendlyError(e)))
  }, [reportError])
  // While a dialog is open, plain Ctrl keys belong to it (e.g. Ctrl+J/K in K's list).
  useEffect(() => { void api.keyMode('overlay', !!overlay).catch(() => {}) }, [overlay])
  // Save at most 100 ms after the first unsaved change. Throttled, not debounced:
  // a busy desktop (pages loading, sessions streaming) must still be saved.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (boot.error || saveTimer.current) return // Never overwrite a database whose startup read failed.
    saveTimer.current = setTimeout(() => { saveTimer.current = undefined; void api.saveDesktop(serializeDesktop(ref.current)).then(() => setStorageError('')).catch(e => setStorageError(friendlyError(e))) }, 100)
  }, [desktop, boot.error])
  useEffect(() => {
    if (boot.error) return
    const flush = () => { try { api.flushDesktop(serializeDesktop(ref.current)) } catch (e) { setStorageError(friendlyError(e)) } }
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); clearTimeout(saveTimer.current) }
  }, [boot.error])

  const update = useCallback((change: (s: TileDesktop) => TileDesktop) => setDesktop(s => { const next = change(s); ref.current = next; return next }), [])
  const changeTile = useCallback((id: string, patch: Partial<Tile>) => update(s => updateTile(s, id, patch)), [update])
  const open = useCallback((input: TileInput, mode: OpenMode = 'here') => {
    try {
      const before = ref.current
      const next = openTile(before, input, mode)
      ref.current = next
      setDesktop(next); setFocusKey(k => k + 1)
      const shelved = next.tiles.filter(t => t.status === 'shelf' && before.tiles.find(b => b.id === t.id)?.status === 'visible')
      if (shelved.length) notify(`${tileTitle(shelved[0])} moved to the shelf to make room`, false, 'Super+=')
    } catch (e) { reportError(friendlyError(e)) }
  }, [reportError, notify])
  const focus = useCallback((id: string) => { update(s => focusTile(s, id)); setFocusKey(k => k + 1) }, [update])
  const go = useCallback((slot: number) => { update(s => goWorkspace(s, slot)); setFocusKey(k => k + 1) }, [update])
  const move = useCallback((id: string, slot: number) => { update(s => moveTile(s, id, slot)); setFocusKey(k => k + 1) }, [update])
  const ask = useCallback((query?: string, source?: SourceID) => { setLauncher({ query, source }); setOverlay('launcher') }, [])
  const openURL = useCallback((url: string, parent?: string) => { try { open(browserTile(url, parent)) } catch (e) { reportError(friendlyError(e)) } }, [open, reportError])
  /** A5: a terminal opens in the folder of the focused tile, or home. */
  const openTerminal = useCallback((directory?: string, mode: OpenMode = 'here', command?: string) => {
    const tile = focusedTile(ref.current)
    const folder = directory || (tile?.kind === 'file' ? tile.path!.replace(/\/[^/]*$/, '') || '/' : tile?.directory) || home
    if (!folder) { reportError('Choose a folder first.'); return }
    try { open({ ...terminalTile(folder), ...(command && { draft: command }) }, mode); notify(`Terminal opened in ${home && folder.startsWith(home) ? `~${folder.slice(home.length)}` : folder}${!directory && tile?.directory ? ', the focused folder' : ''}`, false, 'Super+T') } catch (e) { reportError(friendlyError(e)) }
  }, [home, open, notify, reportError])
  const attachRef = useRef<(id: string, selection?: boolean) => void>(() => {})

  // Every source's live state. The registry is fixed, so hooks run in the same order every render.
  const statesRef = useRef(new Map<string, unknown>())
  const envRef = useRef<Env>(undefined as unknown as Env)
  const env: Env = useMemo(() => ({
    desktop, home, model, connectors, setConnectors,
    editConnector: target => { setConnectorDraft(target); setOverlay('connectors') },
    open, focus, changeTile, setDesktop: update, replaceTile: (id, input) => { update(s => replaceTile(s, id, input)); setFocusKey(k => k + 1) }, notify, reportError, ask, openURL, openTerminal,
    closeOverlay: () => setOverlay(null),
    attach: (id, selection) => attachRef.current(id, selection),
    address: () => setOverlay('address'),
    othersFor: input => registry.flatMap(s => s.others?.(input, statesRef.current.get(s.id), envRef.current) || []),
  }), [desktop, home, model, connectors, open, focus, changeTile, update, notify, reportError, ask, openURL, openTerminal])
  envRef.current = env
  const states = new Map<string, unknown>()
  for (const source of registry) states.set(source.id, source.use(env)) // eslint-disable-line react-hooks/rules-of-hooks
  statesRef.current = states
  const stateOf = (id: string) => states.get(id)

  // Tiles that close for good release what they hold (a page, a shell). Shelving keeps them.
  const released = useRef(new Set<string>())
  const closedKey = desktop.tiles.filter(t => t.status === 'closed').map(t => t.id).sort().join('|')
  useEffect(() => {
    for (const tile of ref.current.tiles) {
      if (tile.status !== 'closed') { released.current.delete(tile.id); continue }
      if (released.current.has(tile.id)) continue
      released.current.add(tile.id)
      sourceFor(tile.kind)?.closed?.(tile)
    }
  }, [closedKey])
  const hide = useCallback((id: string, close = false) => {
    const tile = ref.current.tiles.find(t => t.id === id)
    update(s => shelfTile(s, id, close))
    setFocusKey(k => k + 1)
    notify(close ? tile?.kind === 'terminal' ? 'Terminal closed and its shell ended.' : 'Tile closed. Search reopens it.' : 'Moved to the shelf. Super+= brings it back.')
  }, [notify, update])
  const chooseFolder = async () => {
    try { const folder = await api.chooseFolder(); if (folder) { const target = await api.inspectPath(folder); update(s => ({ ...s, selectedDirectory: target.path, folders: [...new Set([...s.folders, target.path])] })); open(fileTile(target.path)) } } catch (e) { reportError(friendlyError(e)) }
  }
  const contextTargets = registry.flatMap(s => s.contextTargets?.(stateOf(s.id)) || [])
  /** Ctrl+. and “Attach page”: context goes to the linked tile, or one you choose. Nothing is sent. */
  attachRef.current = async (id: string, selection = false) => {
    try {
      const context = await api.browserContext(id, selection), tile = ref.current.tiles.find(t => t.id === id)
      if (selection && !context.text) { notify('Select text on the page first. Nothing was attached.'); return }
      const owner = tile?.linkID && ref.current.tiles.find(t => t.id === tile.linkID && sourceFor(t.kind)?.acceptsContext?.includes(t.kind))
      if (owner) { update(s => { const t = s.tiles.find(t => t.id === owner.id)!; return updateTile(s, t.id, { context: [...t.context, { id: uid(), kind: 'page', name: context.title || context.url, text: `URL: ${context.url}\n\n${context.text}` }] }) }); notify(`Page added to ${tileTitle(owner)}’s draft. Nothing sent.`) }
      else if (!contextTargets.length) notify('Nothing here takes page context yet. Add a source like OpenCode first.')
      else { setPageContext(context); setOverlay('send-page') }
    } catch (e) { reportError(friendlyError(e)) }
  }
  const waiting = registry.flatMap(s => s.waiting?.(stateOf(s.id), env) || [])
  const tileStatus = (tile: Tile) => { const owner = sourceFor(tile.kind); return owner?.tileStatus?.(tile, stateOf(owner.id)) }

  const handler = useRef<(action: string) => void>(() => {})
  handler.current = action => {
    // Ctrl+W waits for its second key, like vim. Show what it can be.
    if (action === 'chord') { setChord(true); clearTimeout(chordTimer.current); chordTimer.current = setTimeout(() => setChord(false), 1500); return }
    setChord(false)
    if (action === 'chord-cancel') return
    if (action === 'launcher') { if (overlay === 'launcher') { if (!firstRun) setOverlay(null) } else ask(); return }
    if (action === 'overview') { setOverlay(o => o === 'overview' ? null : 'overview'); return }
    if (action === 'settings') { setOverlay(o => o === 'settings' ? null : 'settings'); return }
    if (overlay) return
    const tile = focusedTile(ref.current), ws = activeWorkspace(ref.current)
    if (action.startsWith('workspace:')) { go(Number(action.split(':')[1])); return }
    if (action.startsWith('move-workspace:') && tile) { move(tile.id, Number(action.split(':')[1])); return }
    // Cmd+N means “new” in the focused tile's source: a session next to a session, a shell next to a shell.
    if (action === 'new') { const owner = tile && sourceFor(tile.kind); if (!owner?.onShortcut?.('new', stateOf(owner.id), env)) ask(); return }
    if (registry.some(s => s.onShortcut?.(action, stateOf(s.id), env))) return
    if (action === 'new-browser') { setOverlay('address'); return }
    if (action === 'address') {
      const input = tile?.kind === 'browser' ? document.querySelector<HTMLInputElement>(`[data-address-for="${tile.id}"]`) : null
      if (input) { input.focus(); input.select() } else setOverlay('address')
      return
    }
    if (action === 'attach-selection') {
      if (tile?.kind === 'browser') void attachRef.current(tile.id, true)
      else {
        const selected = window.getSelection()?.toString().slice(0, 12_000)
        if (selected && tile && contextTargets.length) { setPageContext({ title: `Selection · ${tileTitle(tile)}`, url: tile.url || '', text: selected }); setOverlay('send-page') }
        else notify(contextTargets.length ? 'Select text first. Nothing was attached.' : 'Nothing here takes context yet. Add a source like OpenCode first.')
      }
      return
    }
    if (action === 'attention') {
      const at = waiting.findIndex(item => item.key === tile?.key)
      const next = waiting[(at + 1) % waiting.length]
      if (!next) { notify('Nothing is waiting on you.'); return }
      const existing = ref.current.tiles.find(t => t.key === next.key)
      if (existing) focus(existing.id); else next.open()
      return
    }
    if (action === 'undo-arrangement') { update(undoArrangement); return }
    if (action === 'restore-tile' || action === 'restore-closed') { update(s => restoreLast(s, action === 'restore-closed')); setFocusKey(k => k + 1); return }
    if (!tile) return
    if (action === 'close-tile' || action === 'shelf-tile') { hide(tile.id, action === 'close-tile'); return }
    if (action === 'rename') { setRenameID(tile.id); setOverlay('rename'); return }
    if (action === 'fullscreen') update(fullscreenTile)
    if (action === 'promote') update(promoteTile)
    if (action.startsWith('focus:') || action.startsWith('swap:')) { update(s => directionTile(s, action.split(':')[1] as Direction, action.startsWith('swap:'))); setFocusKey(k => k + 1) }
    if (action === 'next-tile' || action === 'previous-tile') {
      const ids = ws?.tileIDs || [], index = ids.indexOf(tile.id), next = ids[(index + (action === 'next-tile' ? 1 : -1) + ids.length) % ids.length]; if (next) focus(next)
    }
  }
  useEffect(() => {
    const unsubscribe = api.onEvent(event => {
      if (event.type === 'shortcut') handler.current(event.action)
      if (event.type === 'tile-focus') update(s => focusedTile(s)?.id === event.tileID ? s : focusTile(s, event.tileID))
    })
    const read = createShortcutReader()
    const keys = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const input = { type: 'keyDown', key: event.key, code: event.code, control: event.ctrlKey, alt: event.altKey, meta: event.metaKey, shift: event.shiftKey } as Electron.Input
      // Terminals own their keys, except the window-manager chords.
      const inTerminal = (event.target as HTMLElement | null)?.closest?.('.terminal-host')
      if (inTerminal && !event.metaKey && !(event.ctrlKey && event.altKey) && shortcutFor(input) !== 'attach-selection') return
      const { action, swallow } = read(input)
      if (swallow) event.preventDefault()
      if (action) { handler.current(action); return }
      if (event.key === 'Escape') { setOverlay(o => o && !(o === 'launcher' && firstRunRef.current) ? null : o); return }
      // j/k/h/l inside lists; never while typing.
      if (!inTerminal && !document.querySelector('[role="dialog"]')) listKeys(event)
    }
    document.addEventListener('keydown', keys)
    return () => { unsubscribe(); document.removeEventListener('keydown', keys) }
  }, [update])
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
  /** Where keyboard focus was in each tile, so coming back lands on the same row. */
  const lastFocus = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    if (overlay) return
    const tile = focusedTile(ref.current)
    if (tile?.kind === 'browser') { void api.browserAction({ id: tile.id, action: 'focus' }).catch(() => {}); return }
    if (!tile || tile.kind === 'terminal') return
    const root = document.querySelector<HTMLElement>(`[data-tile-id="${tile.id}"]`)
    if (!root) return
    // In priority order (querySelector alone would pick the first in document order and scroll a list).
    const target = () => {
      const last = lastFocus.current.get(tile.id)
      if (last?.isConnected && root.contains(last)) return last
      for (const selector of ['.composer-input', '[tabindex="0"]', '.tile-body textarea, .tile-body input', rowSelector]) { const found = root.querySelector<HTMLElement>(selector); if (found) return found }
    }
    const found = target()
    if (found) { found.focus({ preventScroll: true }); return }
    // A new tile renders its content later: hold focus on the tile (so j/k leave the old one) and land on the content when it appears.
    root.focus({ preventScroll: true })
    const observer = new MutationObserver(() => {
      if (document.activeElement !== root) { observer.disconnect(); return }
      const late = target()
      if (late) { observer.disconnect(); late.focus({ preventScroll: true }) }
    })
    observer.observe(root, { childList: true, subtree: true })
    const timer = setTimeout(() => observer.disconnect(), 5000)
    return () => { observer.disconnect(); clearTimeout(timer) }
  }, [desktop.activeID, w?.focusedID, overlay])

  const shelf = shelfTiles(desktop)
  const sourceStatus = [
    ...(model?.configured ? [{ key: 'model', name: model.model.split('/').pop()!, ok: model.ready, label: 'Model' }] : []),
    ...registry.flatMap(s => s.status?.(stateOf(s.id)) || []),
  ]
  return <div className={`app tile-app ${machine.platform === 'darwin' ? 'mac' : ''}`} ref={root} data-model-state={!model ? 'loading' : firstRun ? 'setup' : model.ready ? 'ready' : 'skipped'}>
    <header className="workspace-bar" onMouseDown={e => { if ((e.target as HTMLElement).closest('button')) e.preventDefault() }}>
      <div className="workspace-strip">{desktop.workspaces.length ? desktop.workspaces.map(workspace => <button className={`workspace-button workspace-select ${workspace.id === desktop.activeID ? 'selected' : ''}`} key={workspace.id} onClick={() => go(workspace.slot)} title={`Workspace ${workspace.slot} · ${workspace.title}`}><kbd>{workspace.slot}</kbd><span className="truncate">{workspace.title}</span><small>{workspace.tileIDs.length ? `· ${workspace.tileIDs.length}` : ''}</small>{workspace.tileIDs.some(id => { const t = desktop.tiles.find(t => t.id === id); return t && tileStatus(t)?.waiting }) && <Status waiting />}</button>)
        : <button className="workspace-button workspace-select selected" onClick={() => ask()} title="Nothing open yet"><kbd>1</kbd><span>empty</span></button>}</div>
      {!!shelf.length && <div className="shelf-strip" aria-label="Shelf"><span className="shelf-divider" /><button className="shelf-label" onClick={() => setOverlay('overview')}>Shelf</button>{shelf.slice(0, 3).map(tile => <button className="shelf-chip" key={tile.id} onClick={() => focus(tile.id)} title={`${tileTitle(tile)} · ${tileSource(tile)} · click to bring back`}><Badge icon={tileBadge(tile)} size="sm" /><span className="truncate">{tileTitle(tile)}</span>{tileStatus(tile)?.waiting && <Status waiting />}</button>)}{shelf.length > 3 && <button className="shelf-chip more" onClick={() => setOverlay('overview')}>+{shelf.length - 3}</button>}</div>}
      <div className="bar-right">
        <button className="tile-launcher-button" aria-label="Launcher" onClick={() => ask()}>Ask or open…<kbd>Super+K</kbd></button>
        {sourceStatus.map(s => <button key={s.key} className="source-status" aria-label={s.label} title={`${s.label}${s.ok ? '' : ' · needs attention'}`} onClick={() => setOverlay('settings')}><span className={`status-dot ${s.ok ? 'green' : 'amber'}`} />{s.name}</button>)}
        {!!waiting.length && <button className="attention-button" aria-label="Go to waiting session" onClick={() => handler.current('attention')} title="Super+U"><Status waiting />{waiting.length} waiting</button>}
        <IconButton label="Workspace overview" onClick={() => setOverlay('overview')}><LayoutGrid size={15} /></IconButton><IconButton label="Undo arrangement" disabled={!desktop.history.length} onClick={() => update(undoArrangement)}><Undo2 size={15} /></IconButton>
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
        {desktop.tiles.filter(t => t.status !== 'closed').map(tile => {
          const chip = kindChip(tile, connectors), owner = sourceFor(tile.kind), status = tileStatus(tile), isVisible = visible.some(t => t.id === tile.id)
          return <section hidden={!isVisible} style={{ order: visible.findIndex(t => t.id === tile.id) }} className={`resource-tile panel ${visible[0]?.id === tile.id ? 'primary-tile' : ''} ${w?.focusedID === tile.id ? 'tile-focused' : ''}`} data-tile-id={tile.id} data-resource-key={tile.key} data-kind={tile.kind} key={tile.id} onPointerDownCapture={() => { if (focusedTile(ref.current)?.id !== tile.id) focus(tile.id) }} tabIndex={-1} onFocusCapture={e => { const at = e.target as HTMLElement; if (at !== e.currentTarget && !at.closest('.tile-header')) lastFocus.current.set(tile.id, at); if (focusedTile(ref.current)?.id !== tile.id) update(s => focusTile(s, tile.id)) }}>
            <header className="tile-header"><Badge icon={tileBadge(tile)} /><strong className="tile-title truncate" title={tileTitle(tile)}>{tileTitle(tile)}</strong><span className="tile-source truncate" title={tile.url || tile.directory}>{tile.kind === 'terminal' ? '' : tileSource(tile)}{tile.directory && tile.kind !== 'session' ? `${tile.kind === 'terminal' ? '' : ' · '}${home && tile.directory.startsWith(home) ? `~${tile.directory.slice(home.length)}` : tile.directory}` : tile.url ? ` · ${(() => { try { return new URL(tile.url).pathname } catch { return '' } })()}` : ''}</span>{tile.linkID && <span title="Linked to the tile that opened it"><Link size={12} /></span>}{status && <Status running={status.running} waiting={status.waiting} />}
              {registry.map(s => s.headerActions && <span key={s.id} className="tile-header-action">{s.headerActions(tile, stateOf(s.id), env)}</span>)}
              <span className={`tile-type ${chip.generated ? 'generated' : ''}`}>{chip.text}</span>
              <KeyButton className="tile-key" label={`Rename ${tileTitle(tile)}`} keys="F2" onClick={() => { setRenameID(tile.id); setOverlay('rename') }}><Pencil size={12} /></KeyButton>
              <KeyButton className="tile-key" label={`Fullscreen ${tileTitle(tile)}`} keys="⌃W o" onClick={() => { focus(tile.id); update(fullscreenTile) }}><Expand size={13} /></KeyButton><KeyButton className="tile-key" label={`Shelf ${tileTitle(tile)}`} keys="⌃W -" onClick={() => hide(tile.id)}><X size={14} /></KeyButton>
            </header><div className="tile-body">
              {owner?.Tile ? <owner.Tile tile={tile} state={stateOf(owner.id)} env={env} visible={isVisible} focused={focused?.id === tile.id} focusKey={focusKey} /> : <div className="empty-list">No source in this version shows “{tile.kind}” tiles. The tile is kept.</div>}
            </div>
          </section>
        })}
      </div>
    </main>
    {overlay === 'launcher' && <TileLauncher key={`${launcher.query || ''}|${launcher.source || ''}`} env={env} states={states}
      tidy={id => { update(s => tidyAround(focusTile(s, id), id)); notify('Other tiles shelved. Undo arrangement restores them.') }} undo={() => update(undoArrangement)} close={() => { if (!firstRun) { setOverlay(null); setLauncher({}) } }}
      initialSource={launcher.source} initialQuery={launcher.query} model={model} modelChanged={setModel} firstRun={firstRun} />}
    {overlay === 'overview' && <TileOverview desktop={desktop} waiting={t => !!tileStatus(t)?.waiting} focus={focus} move={move} go={go} close={() => setOverlay(null)} />}
    {overlay === 'address' && <AddressDialog submit={url => openURL(url, focused && sourceFor(focused.kind)?.acceptsContext?.includes(focused.kind) ? focused.id : focused?.linkID)} close={() => setOverlay(null)} />}
    {overlay === 'settings' && <SettingsDialog model={model} modelChanged={setModel} env={env} states={states} close={() => setOverlay(null)} platform={machine.platform} />}
    {overlay === 'connectors' && <ConnectorSettings connectors={connectors} changed={setConnectors} open={open} close={() => { setOverlay(null); setConnectorDraft({}) }} initialID={connectorDraft.id || focused?.resource?.connectorID} initialDefinition={connectorDraft.definition} modelReady={!!model?.ready} />}
    {overlay === 'rename' && renameID && <RenameDialog title={tileTitle(desktop.tiles.find(t => t.id === renameID) || { title: '' })} label={desktop.tiles.find(t => t.id === renameID)?.kind === 'session' ? 'Session name' : 'Tile name'} submit={async title => { try { const tile = ref.current.tiles.find(t => t.id === renameID); if (!tile) throw new Error('This tile is no longer available.'); const owner = sourceFor(tile.kind); if (!await owner?.rename?.(tile, title, stateOf(owner.id))) changeTile(tile.id, { label: title.trim() }); setOverlay(null) } catch (e) { reportError(friendlyError(e)) } }} close={() => setOverlay(null)} />}
    {overlay === 'send-page' && pageContext && <SendPage page={pageContext} targets={contextTargets} send={(id, note) => { const target = contextTargets.find(t => t.id === id); if (!target) return; update(s => { let next = s; let tile = next.tiles.find(t => t.key === target.input.key); if (!tile) { next = openTile(next, target.input); tile = next.tiles.find(t => t.key === target.input.key)! } return updateTile(next, tile.id, { draft: note ? `${tile.draft}${tile.draft ? '\n' : ''}${note}` : tile.draft, context: [...tile.context, { id: uid(), kind: 'page', name: pageContext.title || pageContext.url, text: `URL: ${pageContext.url}\n\n${pageContext.text}` }] }) }); notify(`Page added to ${target.title}’s draft. Nothing sent.`) }} close={() => setOverlay(null)} />}
    {chord && <div className="tile-toast chord-hint" role="status"><kbd>Ctrl+W</kbd><span>h j k l move · H J K L swap · w next · o fullscreen · x promote · − shelf · q close</span></div>}
    {toast && <div className={`tile-toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.text}</span>{toast.key && <kbd>{toast.key}</kbd>}<IconButton label="Dismiss notification" onClick={() => setToast(null)}><X size={13} /></IconButton></div>}
  </div>
}
