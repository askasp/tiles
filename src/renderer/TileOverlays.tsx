import { LayoutGrid, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OpenMode, Tile, TileDesktop, TileInput } from '../shared/tiles'
import { fileTile, recipeTile, shelfTiles, tileTitle } from '../shared/tiles'
import type { ConnectorSearch } from '../shared/connectors'
import { addIntent, launcherIntent, launcherScope, modelIntent, resourceAction, resourceLabel, resourceSource, sources as catalogue, terminalIntent, type SourceID } from '../shared/sources'
import type { ModelInfo } from '../shared/model'
import { api, friendlyError } from './data'
import { IconButton, Modal, Status, systemKey } from './ui'
import { BuiltinSetup, ConnectorSetup, KChips, KReply, KRow, ModelSetup, iconText } from './Setup'
import { registry, sourceByID, sourceFor } from './sources/registry'
import type { AnySource, Candidate, Env, Query, Row } from './sources/types'

export const tileSource = (tile: Tile) => tile.kind === 'recipe' ? tile.sourceName || tile.resource?.connectorID || 'Connector' : catalogue.find(s => s.id === resourceSource(tile))?.name || 'Browser'
/** Short badge used in tile headers, the shelf and K rows. */
export const tileBadge = (tile: Pick<TileInput, 'kind' | 'url' | 'resource'>) => {
  const id = resourceSource(tile as TileInput)
  if (id.startsWith('connector:')) return iconText[id.slice(10)] ? id.slice(10) : 'connector'
  return sourceByID(id)?.badge || sourceFor(tile.kind)?.badge || id
}
export function Badge({ icon, size = 'md' }: { icon: string; size?: 'sm' | 'md' }) {
  return <span className={`k-icon k-icon-${icon} ${size}`} aria-hidden>{iconText[icon] || icon.slice(0, 2)}</span>
}
export function tileLocation(tile: Tile, desktop: TileDesktop) {
  const w = desktop.workspaces.find(w => w.id === tile.workspaceID)
  return tile.status === 'shelf' ? 'on the shelf' : tile.status === 'closed' ? 'closed' : `open on ${w?.slot || '?'}`
}
const rankText = (text: string, query: string) => {
  text = text.toLowerCase(); query = query.toLowerCase()
  if (!query) return 1
  if (text === query) return 100
  if (text.startsWith(query)) return 50
  return query.split(/\s+/).every(word => text.includes(word)) ? 10 : 0
}
export type States = Map<string, unknown>
const stateOf = (states: States, source: AnySource) => states.get(source.id)

export interface LauncherProps {
  env: Env; states: States
  tidy: (id: string) => void; undo: () => void; close: () => void
  initialSource?: SourceID; initialQuery?: string
  model?: ModelInfo; modelChanged: (info: ModelInfo) => void; firstRun: boolean
}
export function TileLauncher(props: LauncherProps) {
  const { env, states, tidy, undo, close, model } = props
  const desktop = env.desktop
  const [query, setQuery] = useState(props.initialQuery || '')
  const [scope, setScope] = useState<SourceID | undefined>(props.initialSource)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const [index, setIndex] = useState(0)
  const [expanded, setExpanded] = useState<string>()
  const [committed, setCommitted] = useState<string>()
  const [greeting, setGreeting] = useState('')
  const [found, setFound] = useState<{ query: string; items: Candidate[]; busy: boolean }>({ query: '', items: [], busy: false })
  const [asked, setAsked] = useState<ConnectorSearch>({ resources: [], errors: [] })
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const enter = useRef<() => void>(undefined)
  const add = addIntent(query)
  const known = add?.known ? sourceByID(add.known) : undefined
  // Front, Slack and GitHub ship as connectors: their setup shows straight away, no model call.
  const builtin = add?.known && catalogue.find(c => c.id === add.known)?.connector ? add.known : undefined
  const panel = props.firstRun || modelIntent(query) ? 'model' as const
    : known?.Setup ? 'source' as const
    : builtin ? 'builtin' as const
    : add && committed === add.name.toLowerCase() ? 'connector' as const : undefined
  const tidyQuery = /^(just |hide everything but |keep only )/i.test(query.trim())
  const intent = launcherIntent(query, scope)
  const text = tidyQuery ? query.trim().replace(/^(just |hide everything but |keep only )/i, '') : intent.query
  const q: Query = useMemo(() => ({ raw: query, text, scope: launcherScope(query, scope), prefix: launcherIntent(query).source, rank: (value: string) => rankText(value, text) }), [query, scope, text])
  const searchable = !panel && !add && !tidyQuery
  const addedSources = registry.filter(s => s.added(stateOf(states, s)))
  // Slower lookups: every added source that can search, debounced and dropped when the query changes.
  const searchKey = searchable ? `${q.raw}|${q.scope || ''}` : ''
  useEffect(() => {
    setFound({ query: searchKey, items: [], busy: false })
    if (!searchKey || !q.text) return
    let valid = true
    const timer = setTimeout(() => {
      const pending = addedSources.map(s => s.search?.(q, stateOf(states, s), env)).filter((p): p is Promise<Candidate[]> => !!p)
      if (!pending.length) return
      let left = pending.length
      setFound(f => ({ ...f, busy: true }))
      for (const p of pending) void p.then(items => { if (valid) setFound(f => ({ ...f, items: [...f.items, ...items] })) }).catch(() => {}).finally(() => { if (valid && --left === 0) setFound(f => ({ ...f, busy: false })) })
    }, 180)
    return () => { valid = false; clearTimeout(timer) }
  }, [searchKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const askAI = async () => {
    setOpenError('')
    try { setAsked(await api.planConnectorSearch(query)) } catch (e) { setOpenError(friendlyError(e)) }
  }
  const scopes = addedSources.flatMap(s => s.scopes?.(stateOf(states, s)) || [{ id: s.id, name: catalogue.find(c => c.id === s.id)?.name || s.id }])
  const rows = useMemo<Row[]>(() => {
    if (panel) return []
    if (add) return [{ key: 'add-ai', icon: 'add', title: `Add ${add.name}`, source: 'K', subtitle: model?.ready ? 'K looks up its API and proposes how it shows up · nothing is kept until you approve' : `needs a model · ${systemKey}+K → model`, action: 'Ask K', run: () => setCommitted(add.name.toLowerCase()) }]
    if (/^(?:add|connect)\s*$/i.test(query)) {
      return [...catalogue.filter(c => !c.builtin && (c.connector ? !env.connectors.some(x => x.definition.id === c.id) : !addedSources.some(s => s.id === c.id) && sourceByID(c.id)?.Setup)).map(c => ({ key: `add:${c.id}`, icon: sourceByID(c.id)?.badge || c.id, title: `Add ${c.name}`, source: 'Source', subtitle: c.hint, action: 'Set up', fill: `add ${c.id}`, run: () => {} })),
        { key: 'add:any', icon: 'add', title: 'Add anything with an API', source: 'K', subtitle: 'type its name, e.g. “add linear” · K builds a connector', action: 'Type a name', fill: 'add ', run: () => {} },
        { key: 'add:model', icon: 'ai', title: model?.ready ? `Model · ${model.model}` : 'Connect a model', source: 'Model', subtitle: 'the AI that powers K', action: 'Set up', fill: 'model', run: () => {} }]
    }
    // `mail …`, `dm …` before that source is added: offer to add it, load nothing.
    // (`dm`/`pr` aren't a firm scope: “PR cleanup” may be a session title.)
    const missing = q.scope?.startsWith('connector:') && catalogue.find(c => c.connector && `connector:${c.id}` === q.scope && !env.connectors.some(x => x.definition.id === c.id))
    if (missing) return [{ key: `add:${missing.id}`, icon: missing.id, title: `Add ${missing.name}`, source: 'Source', subtitle: `${missing.name} isn’t added yet · ${missing.hint.toLowerCase()}`, action: 'Set up', fill: `add ${missing.id}`, first: true, run: () => {} }]
    const commands = tidyQuery ? [] : registry.flatMap(s => s.commands?.(q, stateOf(states, s), env) || [])
    if (commands.some(c => c.exclusive)) return commands.filter(c => c.exclusive)
    // Resources: what's on the desktop, what each added source knows, and what searches found.
    const best = new Map<string, Candidate & { existing?: Tile }>()
    const offer = (c: Candidate & { existing?: Tile }) => {
      const old = best.get(c.input.key)
      if (!old) { best.set(c.input.key, c); return }
      // A desktop tile keeps its identity and local name; a better score still wins.
      if (c.score > old.score) best.set(c.input.key, { ...c, existing: old.existing, input: old.existing ? { ...c.input, title: tileTitle(old.existing) } : c.input })
    }
    for (const tile of desktop.tiles) offer({ input: { ...tile, title: tileTitle(tile) }, existing: tile, score: Math.max(q.rank(`${tileTitle(tile)} ${tile.title} ${tile.url || ''} ${tile.path || ''} ${tile.directory || ''} ${tile.kind}`), query.trim() ? rankText(tileTitle(tile), query.trim()) : 0) })
    for (const s of addedSources) for (const c of s.candidates?.(q, stateOf(states, s), env) || []) offer(c)
    if (found.query === searchKey) for (const c of found.items) offer(c)
    for (const resource of asked.resources) {
      const c = env.connectors.find(x => x.definition.id === resource.ref.connectorID), recipe = c?.definition.recipes.find(r => r.id === resource.ref.recipeID)
      if (c && recipe) offer({ input: recipeTile(resource.ref, resource.title, recipe, c.definition.name), score: 100 })
    }
    const matches = [...best.values()].filter(c => c.score > 0 && (!q.scope || resourceSource(c.input) === q.scope) && (!tidyQuery || !!c.existing)).sort((a, b) => b.score - a.score || (b.existing?.lastUsed || 0) - (a.existing?.lastUsed || 0)).slice(0, 30)
    const openResource = async (input: TileInput, mode: OpenMode) => {
      if (input.kind === 'folder' || input.kind === 'file') { const path = await api.inspectPath(input.path!); env.open(fileTile(path.path, path.kind), mode) }
      else env.open(input, mode)
    }
    const resources: Row[] = matches.map(({ input, existing }) => {
      const [, kindLabel, actionLabel] = resourceAction(input).split(' · ')
      const place = input.path || input.directory || input.url || ''
      const owner = sourceFor(input.kind), status = owner?.tileStatus?.(input as Tile, stateOf(states, owner))
      return {
        key: input.key, icon: tileBadge(input), title: tidyQuery ? `Keep only ${input.title} + linked tiles` : input.title, source: resourceLabel(input),
        subtitle: [input.kind === 'recipe' ? kindLabel : '', env.home && place.startsWith(env.home) ? `~${place.slice(env.home.length)}` : place, existing ? tileLocation(existing, desktop) : ''].filter(Boolean).join(' · '),
        action: tidyQuery ? 'Keep only' : existing?.status === 'visible' ? 'Go to tile' : existing?.status === 'shelf' ? 'Bring back' : actionLabel,
        waiting: !!status?.waiting, others: tidyQuery ? undefined : env.othersFor(input),
        run: (mode: OpenMode) => { if (tidyQuery && existing) tidy(existing.id); else return openResource(input, mode) },
      }
    })
    if (tidyQuery) return resources
    const narrow: Row[] = !q.scope && q.text ? scopes.filter(s => s.name.toLowerCase() === q.text.toLowerCase() && !(s.id === 'terminal' && terminalIntent(q.raw))).map(s => ({ key: `source:${s.id}`, icon: sourceByID(s.id)?.badge || (iconText[s.id.slice(10)] ? s.id.slice(10) : 'connector'), title: s.name, source: 'Source', subtitle: catalogue.find(c => c.id === s.id || `connector:${c.id}` === s.id)?.hint || 'Search this source', action: 'Narrow to source', scope: s.id, run: () => {} })) : []
    const addRow: Row[] = !query.trim() && !scope ? [{ key: 'add-source', icon: 'add', title: 'Add a source', source: 'K', subtitle: `${catalogue.filter(c => !c.builtin).map(c => c.name).slice(0, 3).join(', ')}${model?.ready ? ', or anything with an API' : '… · a model lets K add any API'}`, action: 'Choose', fill: 'add ', run: () => {} }] : []
    return [...narrow, ...commands.filter(c => c.first), ...resources, ...commands.filter(c => !c.first), ...addRow]
  }, [panel, add?.name, query, q, scope, model?.ready, model?.model, desktop, states, env, found, searchKey, asked, tidyQuery, tidy, scopes.map(s => s.id).join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const expandedRow = rows.find(r => r.key === expanded)
  const shown: Row[] = expandedRow ? expandedRow.others!.map((o, i) => ({ key: `${expandedRow.key}:other:${i}`, icon: expandedRow.icon, title: o.label, source: expandedRow.source, subtitle: expandedRow.title, action: o.label, run: o.run })) : rows
  useEffect(() => { list.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }) }, [index])
  // Clicked rows and finished panels unmount; keep typing and ↵ going to K.
  useEffect(() => { if (document.activeElement === document.body || !document.activeElement?.isConnected) input.current?.focus() })
  useEffect(() => { setExpanded(undefined); setAsked({ resources: [], errors: [] }) }, [query, scope])
  const chosen = Math.min(index, shown.length - 1)
  const execute = async (mode: OpenMode, i = chosen) => {
    const row = shown[i]
    if (!row || opening || row.disabled) return
    if (row.scope) { setScope(row.scope); setQuery(''); setIndex(0); setOpenError(''); return }
    if (row.fill !== undefined) { setQuery(row.fill); setIndex(0); input.current?.focus(); return }
    if (row.key === 'add-ai') { void row.run(mode); return }
    setOpening(true); setOpenError('')
    try { await row.run(mode); close() } catch (e) { setOpenError(friendlyError(e)); setOpening(false) }
  }
  const move = (delta: number) => setIndex(i => Math.max(0, Math.min(shown.length - 1, i + delta)))
  const scopeName = scope && scopes.find(s => s.id === scope)?.name
  const knownState = known ? stateOf(states, known) : undefined
  const canAsk = !!env.connectors.length && !!model?.ready && !!query.trim()
  const foot = panel || add ? ['↵ continue', 'esc cancel'] : expandedRow ? ['↑↓ ⌃J ⌃K choose', '↵ run here', '← back'] : ['↑↓ ⌃J ⌃K choose', '↵ open here', '⌃↵ or ⌘↵ new workspace', '→ other actions', scope ? '⌫ widen to everything' : 'Tab narrow to a source', ...(canAsk ? ['Alt+↵ ask K to find it'] : [])]
  return <Modal title="Launcher" close={close}>
    <div className="launcher-input k-input-row"><span className="k-logo">K</span>{scopeName && <button className="k-scope" onClick={() => { setScope(undefined); input.current?.focus() }} title="Widen to all sources">{scopeName}<span>›</span></button>}<input ref={input} autoFocus aria-label="Launcher search" placeholder={props.firstRun ? 'Connect a model to get started' : scopeName ? `Search ${scopeName.toLowerCase()}…` : 'Ask or open… a page, folder, terminal, or “add …”'} value={query} onChange={e => { setQuery(e.target.value); setIndex(0); setOpenError('') }} onKeyDown={e => {
      if (e.nativeEvent.isComposing) return
      if (panel) { if (e.key === 'Enter') { e.preventDefault(); enter.current?.() } return }
      // Arrows, or vim/emacs-style Ctrl+J/N down and Ctrl+K/P up.
      const down = e.key === 'ArrowDown' || (e.ctrlKey && !e.altKey && ['j', 'n'].includes(e.key.toLowerCase()))
      const up = e.key === 'ArrowUp' || (e.ctrlKey && !e.altKey && ['k', 'p'].includes(e.key.toLowerCase()))
      // Inside K, Ctrl+K moves up (it opens K everywhere else).
      if (down || up) { e.preventDefault(); e.stopPropagation(); move(down ? 1 : -1) }
      if ((e.key === 'ArrowRight' || (e.ctrlKey && e.key.toLowerCase() === 'l')) && !expandedRow && shown[chosen]?.others?.length && e.currentTarget.selectionStart === query.length) { e.preventDefault(); setExpanded(shown[chosen].key); setIndex(0) }
      if ((e.key === 'ArrowLeft' || (e.ctrlKey && e.key.toLowerCase() === 'h')) && expandedRow) { e.preventDefault(); setIndex(Math.max(0, rows.indexOf(expandedRow))); setExpanded(undefined) }
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && scopes.length) {
        e.preventDefault(); e.stopPropagation()
        const byName = q.text && !add && scopes.find(s => s.name.toLowerCase().startsWith(q.text.toLowerCase()))
        const at = scopes.findIndex(s => s.id === scope)
        // Tab walks All → each source → Add source → All.
        if (byName && !scope) { setScope(byName.id); setQuery('') }
        else if (/^add\s*$/i.test(query)) { setQuery(''); setScope(undefined) }
        else if (at === scopes.length - 1) { setScope(undefined); setQuery('add ') }
        else setScope(scopes[at + 1].id)
        setIndex(0)
      }
      // Ctrl+Enter (or Cmd+Enter on a Mac): in a new workspace. Shift+Enter: move here.
      // Alt+Enter: ask K (the model) to find it in the connected services.
      if (e.key === 'Enter' && e.altKey) { e.preventDefault(); if (canAsk) void askAI(); return }
      if (e.key === 'Enter') { e.preventDefault(); void execute(e.shiftKey ? 'move' : e.ctrlKey || e.metaKey ? 'new' : 'here') }
      if (e.key === 'Backspace' && !query && scope) { e.preventDefault(); setScope(undefined); setIndex(0) }
      if (e.key === 'z' && e.ctrlKey && !query) { e.preventDefault(); undo() }
    }} /><kbd>esc</kbd><IconButton label="Close launcher" onClick={close}><X size={15} /></IconButton></div>
    {!panel && !add && <nav className="launcher-sources" aria-label="Search sources"><button className={`pill ${!q.scope ? 'primary' : ''}`} aria-pressed={!q.scope} onClick={() => { setScope(undefined); setQuery(q.text); setIndex(0); input.current?.focus() }}>All sources</button>{scopes.map(s => <button key={s.id} className={`pill ${q.scope === s.id ? 'primary' : ''}`} aria-pressed={q.scope === s.id} onClick={() => { setScope(s.id); setQuery(q.text); setIndex(0); setOpenError(''); input.current?.focus() }}>{s.name}</button>)}<button className="pill" onClick={() => { setScope(undefined); setQuery('add '); input.current?.focus() }}>Add source</button>{!!env.connectors.length && model?.ready && <button className="pill" disabled={!query.trim()} onClick={() => void askAI()}>Ask K to find…<kbd aria-hidden>Alt+↵</kbd></button>}</nav>}
    {panel === 'model' && <ModelSetup info={model} firstRun={props.firstRun} enter={enter} saved={info => { props.modelChanged(info); setQuery(''); input.current?.focus(); setGreeting(`Ready. ${info.model} powers K. Browser, Files and Terminal are built in; anything else with an API you can add by asking.`) }} skip={props.firstRun ? () => { void api.skipModel().then(info => { props.modelChanged(info); setQuery(''); input.current?.focus(); setGreeting('Browser, Files and Terminal are ready. Type “model” here whenever you want K to add services for you.') }).catch(e => setOpenError(friendlyError(e))) } : undefined} />}
    {panel === 'source' && known?.Setup && <known.Setup key={known.id} state={knownState} env={env} name={add!.name} done={close} enter={enter} />}
    {panel === 'builtin' && builtin && <BuiltinSetup key={builtin} id={builtin} connectors={env.connectors} changed={env.setConnectors} enter={enter} open={i => env.open(i, 'here')} done={close} />}
    {panel === 'connector' && add && <ConnectorSetup key={add.name.toLowerCase()} name={add.name} model={model} connectors={env.connectors} changed={env.setConnectors} enter={enter} open={i => env.open(i, 'here')} adjust={definition => env.editConnector({ definition })} setupModel={() => setQuery('model')} done={close} />}
    {greeting && !query && !panel && <KReply>{greeting}</KReply>}
    {!panel && <FirstMessageChips rows={rows} />}
    {openError && <div className="inline-error" role="alert">{openError}</div>}
    {!panel && !!asked.errors.length && <div className="inline-error">{asked.errors.slice(0, 2).join(' · ')}</div>}
    {!panel && <div className="tile-launcher-results" ref={list}>{expandedRow && <span className="k-head">Other actions · {expandedRow.title}</span>}{shown.map((row, i) => <KRow key={row.key} icon={row.icon} title={row.title} label={`${row.title} · ${row.source} · ${row.action}`} source={row.source} subtitle={row.subtitle} action={row.action} hint={i === chosen && !row.disabled ? '↵' : row.others?.length && !expandedRow ? '→' : ''} selected={i === chosen} disabled={opening || row.disabled} onClick={e => { setIndex(i); void execute(e.shiftKey ? 'move' : e.ctrlKey || e.metaKey ? 'new' : 'here', i) }} />)}
      {!shown.length && <div className="empty-list">{found.busy ? 'Searching… ↵ won’t create anything.' : 'Nothing matches. Try a title, folder, URL, or “add …” for a new source.'}</div>}
      {rows.some(r => r.waiting) && <span className="k-head"><Status waiting /> waiting on you</span>}
    </div>}
    <footer className="k-foot">{foot.map(f => <span key={f}>{f}</span>)}<span className="k-status">{opening ? 'Opening…' : found.busy ? 'Searching your sources…' : ''}</span></footer>
  </Modal>
}
/** C3: when a command carries a first message, show what will be sent before anything runs. */
function FirstMessageChips({ rows }: { rows: Row[] }) {
  const row = rows.find(r => r.first && r.subtitle.startsWith('first message: '))
  if (!row) return null
  return <KChips items={[{ label: 'Where', value: row.title.replace(/^Start session in /, '') }, { label: 'First message', value: row.subtitle.slice('first message: '.length) }]} />
}

export function TileOverview({ desktop, waiting, focus, move, go, close }: { desktop: TileDesktop; waiting: (tile: Tile) => boolean; focus: (id: string) => void; move: (id: string, slot: number) => void; go: (slot: number) => void; close: () => void }) {
  const [destination, setDestination] = useState(desktop.workspaces.find(w => w.id === desktop.activeID)?.slot || 1)
  return <Modal title="Workspace overview" close={close} wide>
    <div className="modal-heading"><LayoutGrid size={18} /><h2>Workspaces & shelf</h2><span className="muted">One tile, one place</span><IconButton label="Close overview" onClick={close}><X size={15} /></IconButton></div>
    <div className="tile-overview" onKeyDown={e => {
      // j/k or ↑↓ through every tile (shelf included), ↵ goes there, a digit moves it to that workspace.
      if (e.ctrlKey || e.altKey || e.metaKey || (e.target as HTMLElement).tagName === 'INPUT') return
      const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-overview-tile]')], at = rows.indexOf(e.target as HTMLElement)
      if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (e.key === 'j' || e.key === 'ArrowDown' ? 1 : -1)))]?.focus() }
      if (/^[1-9]$/.test(e.key) && at >= 0) { e.preventDefault(); e.stopPropagation(); move(rows[at].dataset.overviewTile!, Number(e.key)); close() }
    }}><div className="tile-workspace-cards">{desktop.workspaces.map(w => <section className={`tile-workspace-card ${desktop.activeID === w.id ? 'selected' : ''}`} key={w.id} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); move(e.dataTransfer.getData('text/chatos-tile'), w.slot); close() }}>
      <button className="overview-workspace-heading" onClick={() => { go(w.slot); close() }}><kbd>{systemKey === '⌘' ? `⌘${w.slot}` : `Ctrl+Alt+${w.slot}`}</kbd><strong>{w.title}</strong><span>{w.tileIDs.length}/4</span></button>
      {w.tileIDs.map(id => { const t = desktop.tiles.find(t => t.id === id)!; return <button className="overview-tile-row" data-overview-tile={id} key={id} draggable onDragStart={e => e.dataTransfer.setData('text/chatos-tile', id)} onClick={() => { focus(id); close() }}><Badge icon={tileBadge(t)} size="sm" /><span className="truncate">{tileTitle(t)}</span>{waiting(t) && <Status waiting />}</button> })}
      {!w.tileIDs.length && <p className="muted">Empty · open something with {systemKey}+K</p>}
    </section>)}{!desktop.workspaces.length && <p className="muted">No workspaces yet. {systemKey}+K opens the first tile.</p>}</div>
    <aside className="overview-shelf"><h3>Shelf · {shelfTiles(desktop).length}</h3><label className="form-field">Move selected tile to workspace<input aria-label="Shelf destination workspace" type="number" min={1} value={destination} onChange={e => setDestination(Math.max(1, Number(e.target.value)))} /></label>
      {shelfTiles(desktop).map(t => <div className="overview-shelf-row" key={t.id} draggable onDragStart={e => e.dataTransfer.setData('text/chatos-tile', t.id)}><button data-overview-tile={t.id} onClick={() => { focus(t.id); close() }}><Badge icon={tileBadge(t)} size="sm" /><span className="truncate">{tileTitle(t)}</span>{waiting(t) && <Status waiting />}</button><button className="text-button" aria-label={`Move ${tileTitle(t)} to workspace ${destination}`} onClick={() => { move(t.id, destination); close() }}>Move</button></div>)}
      {!shelfTiles(desktop).length && <p className="muted">Hidden tiles stay live here. Search finds closed tiles too.</p>}
    </aside></div>
    <footer className="modal-footer"><span><kbd>j k</kbd> choose a tile · <kbd>↵</kbd> go there · <kbd>1–9</kbd> move it to that workspace · or drag. Sessions and shells keep running.</span></footer>
  </Modal>
}
