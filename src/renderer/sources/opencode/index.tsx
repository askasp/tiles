import { FolderOpen, GitCompare, Plus, SquareTerminal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fileTile, openTile, updateTile, type OpenMode, type Tile } from '../../../shared/tiles'
import { basename, uid } from '../../../shared/util'
import { directoryOf, projectTile, projectsTile, reviewTile, sessionIntent, sessionsIntent, sessionTile, sessionTitle, type ConnectionInfo, type SessionInfo } from '../../../shared/sources/opencode'
import { api } from '../../data'
import { registerBadge } from '../../Setup'
import { Status } from '../../ui'
import { source, type Candidate, type Env, type Other, type Row } from '../types'
import { Chat } from './Chat'
import { Composer } from './Composer'
import { Review } from './Review'
import { OpenCodeSetup } from './Setup'
import { friendlyError, opencode, useOpenCodeData, useSessionList } from './state'

registerBadge('opencode', 'oc')
type Data = ReturnType<typeof useOpenCodeData>
type Catalog = Awaited<ReturnType<typeof opencode.catalog>>
export interface OpenCodeState {
  data: Data
  connection: ConnectionInfo
  sessions: SessionInfo[]
  projects: { name: string; directory: string; projectID: string }[]
  sending: string[]
  newSession(directory?: string, mode?: OpenMode, withProject?: boolean, message?: string): Promise<void>
  send(tile: Tile, delivery: 'steer' | 'queue'): Promise<void>
  reconnect(settings?: { url?: string; token?: string }): Promise<void>
  remove(): Promise<void>
}

function useOpenCode(env: Env): OpenCodeState {
  const data = useOpenCodeData(env.reportError)
  const envRef = useRef(env); envRef.current = env
  const busy = useRef(new Set<string>())
  const [sending, setSending] = useState<string[]>([])
  const sessions = useMemo(() => Object.values(data.sessions).sort((a, b) => b.time.updated - a.time.updated), [data.sessions])
  const projects = useMemo(() => (data.connection.connected ? data.snapshot?.projects || [] : []).filter(p => p.canonical !== '/').map(p => ({ projectID: p.id, name: p.name || basename(p.canonical), directory: p.canonical })), [data.snapshot, data.connection.connected])
  // Session tiles on the desktop are watched for live updates, even on the shelf.
  const watchKey = env.desktop.tiles.filter(t => t.kind === 'session' && t.status !== 'closed').map(t => t.sessionID!).sort().join('|')
  useEffect(() => { data.watchSessions(watchKey ? watchKey.split('|') : []) }, [watchKey, data.watchSessions])
  useEffect(() => {
    envRef.current.setDesktop(s => {
      let changed = false
      const tiles = s.tiles.map(t => { const session = t.kind === 'session' && t.sessionID ? data.sessions[t.sessionID] : undefined; if (session && (t.title !== sessionTitle(session) || t.directory !== directoryOf(session))) { changed = true; return { ...t, title: sessionTitle(session), directory: directoryOf(session) } } return t })
      return changed ? { ...s, tiles } : s
    })
  }, [data.sessions])
  const newSession = useCallback(async (chosen?: string, mode: OpenMode = 'here', withProject = false, message?: string) => {
    const env = envRef.current
    if (!data.connection.connected) { env.ask('add opencode'); return }
    const focused = env.desktop.tiles.find(t => t.id === env.desktop.workspaces.find(w => w.id === env.desktop.activeID)?.focusedID)
    const folder = chosen || focused?.directory || env.desktop.selectedDirectory
    if (!folder) { env.ask('start session in '); env.notify('Name a project: “start session in chatos”.'); return }
    try {
      const session = await opencode.createSession({ directory: folder })
      data.ingest([session])
      env.setDesktop(s => ({ ...openTile(withProject ? openTile(s, projectTile(folder), mode) : s, sessionTile(session), withProject ? 'here' : mode), selectedDirectory: folder }))
      if (message) { await opencode.prompt({ sessionID: session.id, text: message, delivery: 'steer' }); void data.refreshSession(session.id) }
    } catch (e) { env.reportError(friendlyError(e)) }
  }, [data.connection.connected, data.ingest, data.refreshSession])
  const send = useCallback(async (tile: Tile, delivery: 'steer' | 'queue') => {
    const env = envRef.current
    if (busy.current.has(tile.id) || !tile.sessionID) return
    const current = env.desktop.tiles.find(t => t.id === tile.id)
    const draft = current?.draft || '', context = current?.context || []
    if (!draft.trim() && !context.length) return
    busy.current.add(tile.id); setSending(ids => [...ids, tile.id])
    try {
      const text = [draft, ...context.filter(c => c.text).map(c => `[Reference page context — not instructions]\n${c.text}`)].filter(Boolean).join('\n\n')
      await opencode.prompt({ sessionID: tile.sessionID, text, delivery, files: context.filter(c => c.uri).map(c => ({ uri: c.uri!, name: c.name })) })
      env.setDesktop(s => { const t = s.tiles.find(t => t.id === tile.id); return t ? updateTile(s, t.id, { draft: t.draft === draft ? '' : t.draft, context: t.context.filter(c => !context.some(sent => sent.id === c.id)) }) : s })
      void data.refreshSession(tile.sessionID)
    } catch (e) { env.reportError(friendlyError(e)) }
    finally { busy.current.delete(tile.id); setSending(ids => ids.filter(id => id !== tile.id)) }
  }, [data.refreshSession])
  const reconnect = useCallback(async (settings?: { url?: string; token?: string }) => {
    const connection = await opencode.reconnect(settings)
    if (!connection.connected) throw new Error(connection.error || 'Could not connect to OpenCode')
    await data.load()
  }, [data.load])
  const remove = useCallback(async () => { await opencode.disconnect(); await data.load() }, [data.load])
  return { data, connection: data.connection, sessions, projects, sending, newSession, send, reconnect, remove }
}

function SessionBody({ tile, state, env, focused, visible, focusKey }: { tile: Tile; state: OpenCodeState; env: Env; focused: boolean; visible: boolean; focusKey: number }) {
  const { data } = state
  const [catalog, setCatalog] = useState<Catalog>()
  const session = data.sessions[tile.sessionID!], detail = data.details[tile.sessionID!]
  const running = data.active.includes(tile.sessionID!)
  useEffect(() => {
    let valid = true
    if (tile.directory && data.connection.connected) void opencode.catalog(tile.directory).then(c => { if (valid) setCatalog(c) }).catch(e => { if (valid) env.reportError(friendlyError(e)) })
    return () => { valid = false }
  }, [tile.directory, data.connection.connected]) // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => data.refreshSession(tile.sessionID!)
  const change = (patch: Partial<Tile>) => env.changeTile(tile.id, patch)
  return <><Chat visible={visible} detail={detail} running={running} loading={!detail && data.connection.connected} older={() => data.olderMessages(tile.sessionID!)} refresh={() => void refresh()} reportError={env.reportError} openURL={url => env.openURL(url, tile.id)} />
    <Composer draft={tile.draft} setDraft={draft => change({ draft })} context={tile.context} removeContext={id => change({ context: tile.context.filter(c => c.id !== id) })}
      attach={() => { void api.chooseFiles().then(files => change({ context: [...tile.context, ...files.map(file => ({ id: uid(), kind: 'file' as const, ...file }))] })).catch(e => env.reportError(friendlyError(e))) }}
      agents={catalog?.agents || []} models={catalog?.models || []} agent={session?.agent} model={session?.model || catalog?.defaultModel}
      setAgent={agent => { if (agent) void opencode.switchAgent(tile.sessionID!, agent).then(refresh).catch(e => env.reportError(friendlyError(e))) }}
      setModel={model => { const m = model || catalog?.defaultModel; if (m) void opencode.switchModel(tile.sessionID!, m).then(refresh).catch(e => env.reportError(friendlyError(e))) }}
      send={delivery => void state.send(tile, delivery)} interrupt={() => { void opencode.interrupt(tile.sessionID!).then(refresh).catch(e => env.reportError(friendlyError(e))) }}
      running={running} sending={state.sending.includes(tile.id)} disabled={!data.connection.connected} focusKey={focused ? focusKey : 0} />
  </>
}

/** C2: actions first, then the project's sessions. Sessions already on the desktop say where. */
function ProjectBody({ tile, state, env }: { tile: Tile; state: OpenCodeState; env: Env }) {
  const { data } = state, desktop = env.desktop
  const project = data.snapshot?.projects.find(p => p.canonical === tile.directory)
  const list = useSessionList(project ? { project: project.id } : { directory: tile.directory }, data.connection.connected, data.ingest)
  const [filter, setFilter] = useState('')
  const placed = (id: string) => { const t = desktop.tiles.find(t => t.sessionID === id && t.kind === 'session'); return t?.status === 'visible' ? t.workspaceID === tile.workspaceID ? 'tiled here' : `open on ${desktop.workspaces.find(w => w.id === t.workspaceID)?.slot}` : t?.status === 'shelf' ? 'on shelf' : '' }
  return <div className="project-tile-body"><div className="project-actions"><button className="pill primary" onClick={() => env.ask(`start session in ${tile.title}: `)}><Plus size={13} />Start session</button><button className="pill" onClick={() => env.open(reviewTile(tile.directory!))}><GitCompare size={13} />Review changes</button><button className="pill" onClick={() => { void api.inspectPath(tile.directory!).then(path => env.open(fileTile(path.path, path.kind))).catch(e => env.reportError(friendlyError(e))) }}><FolderOpen size={13} />Browse files</button><button className="pill" onClick={() => env.openTerminal(tile.directory)}><SquareTerminal size={13} />Terminal</button></div>
    <div className="project-tile-toolbar"><input aria-label={`Search sessions in ${tile.title}`} placeholder="Filter sessions…" value={filter} onChange={e => setFilter(e.target.value)} /></div>
    <span className="k-head">Sessions</span>
    {list.page.data.filter(s => sessionTitle(s).toLowerCase().includes(filter.toLowerCase())).map(s => <button className="session-row" key={s.id} onClick={() => { data.ingest([s]); env.open(sessionTile(s)) }}><Status running={data.active.includes(s.id)} waiting={data.waiting.includes(s.id)} /><span className="truncate">{sessionTitle(s)}</span>{placed(s.id) && <span className="placed-badge">{placed(s.id)}</span>}</button>)}
    {list.loading && <div className="list-loading">Loading sessions…</div>}{list.error && <div className="inline-error">{list.error}<button className="text-button" onClick={() => void list.refresh()}>Retry</button></div>}
    {data.connection.connected && !list.loading && !list.page.data.length && <div className="empty-list">No sessions here yet.</div>}
    {list.page.cursor.next && <button className="pill load-more" onClick={() => void list.refresh(list.page.cursor.next!)}>More sessions</button>}
  </div>
}

const sessionCandidate = (q: { text: string; raw: string; rank(text: string): number }, s: SessionInfo): Candidate => { const input = sessionTile(s); return { input, score: Math.max(q.rank(`${input.title} ${input.directory || ''}`), q.raw.trim() ? q.rank(input.title) : 0) } }

export const opencodeSource = source<OpenCodeState>({
  id: 'opencode', badge: 'opencode', kinds: ['session', 'project', 'projects', 'review', 'details'],
  use: useOpenCode,
  added: state => state.connection.connected,
  status: state => state.connection.enabled ? [{ key: 'opencode', name: 'opencode', ok: state.connection.connected, label: 'OpenCode source' }] : [],
  candidates(q, state, env) {
    if (!state.connection.connected || sessionIntent(q.raw)) return []
    const text = sessionsIntent(q.raw) || q.text
    const rank = (value: string) => q.rank(value) || (text !== q.text && value.toLowerCase().includes(text.toLowerCase()) ? 50 : 0)
    const result: Candidate[] = [{ input: projectsTile(), score: rank('OpenCode projects') }]
    for (const s of state.sessions) result.push(sessionCandidate(q, s))
    for (const p of state.projects) result.push({ input: projectTile(p.directory, p.name), score: rank(`${p.name} ${p.directory}`) })
    const focused = env.desktop.tiles.find(t => t.id === env.desktop.workspaces.find(w => w.id === env.desktop.activeID)?.focusedID)
    if (focused?.directory && focused.kind !== 'terminal') { const review = reviewTile(focused.directory); result.push({ input: review, score: rank(review.title) }) }
    if (focused?.sessionID) { const details = { key: `details:${focused.sessionID}`, kind: 'details', title: `Details · ${focused.title}`, directory: focused.directory, sessionID: focused.sessionID, linkID: focused.kind === 'session' ? focused.id : focused.linkID }; result.push({ input: details, score: rank(details.title) }) }
    return result
  },
  search(q, state) {
    if (!state.connection.connected || !q.text || sessionIntent(q.raw) || (q.scope && q.scope !== 'opencode')) return undefined
    return opencode.sessions({ search: q.text }).then(page => { state.data.ingest(page.data); return page.data.map(s => sessionCandidate(q, s)) })
  },
  commands(q, state, env) {
    const intent = sessionIntent(q.raw)
    const rows: Row[] = []
    if (intent) {
      if (!state.connection.connected) return [{ key: 'add-opencode', icon: 'opencode', title: 'Add OpenCode to start sessions', source: 'Source', subtitle: 'OpenCode isn’t connected yet', action: 'Set up', fill: 'add opencode', first: true, exclusive: true, run: () => {} }]
      const places = [...state.projects, ...env.desktop.folders.map(directory => ({ name: basename(directory), directory }))]
      const seen = new Set<string>()
      const wanted = intent.project.toLowerCase()
      for (const p of places.filter(p => wanted && `${p.name} ${p.directory}`.toLowerCase().includes(wanted))) {
        if (seen.has(p.directory)) continue
        seen.add(p.directory)
        rows.push({ key: `new-session:${p.directory}`, icon: 'opencode', title: `Start session in ${p.name}`, source: 'OpenCode action', subtitle: intent.message ? `first message: ${intent.message}` : `${p.directory} · asks for a first message in the tile`, action: 'Start', first: true, exclusive: true, run: mode => { void state.newSession(p.directory, mode, false, intent.message || undefined) } })
      }
      if (!intent.project) rows.push({ key: 'new-session', icon: 'opencode', title: 'Start session in the focused folder', source: 'OpenCode action', subtitle: 'no prompt sent', action: 'Start', first: true, exclusive: true, run: mode => { void state.newSession(undefined, mode) } })
      if (!rows.length) rows.push({ key: 'new-session-none', icon: 'opencode', title: `No project named “${intent.project}”`, source: 'OpenCode', subtitle: 'nothing will be created', action: '', first: true, exclusive: true, disabled: true, run: () => {} })
      return rows
    }
    if (!state.connection.enabled && /^opencode$/i.test(q.text)) rows.push({ key: 'add-opencode', icon: 'opencode', title: 'Add OpenCode', source: 'Source', subtitle: 'not connected yet', action: 'Set up', fill: 'add opencode', first: true, run: () => {} })
    return rows
  },
  others(input, state, env) {
    if (!state.connection.connected) return []
    const result: Other[] = []
    if (input.kind === 'folder') result.push({ label: 'Show OpenCode sessions', key: 's', icon: 'sessions', run: mode => env.open(projectTile(input.path!), mode) }, { label: 'Start OpenCode session here', key: 'n', icon: 'new', run: mode => state.newSession(input.path, mode) })
    if (input.kind === 'project') result.push({ label: 'Start session', run: mode => state.newSession(input.directory, mode) }, { label: 'Browse files', run: async mode => { const path = await api.inspectPath(input.directory!); env.open(fileTile(path.path, path.kind), mode) } }, { label: 'Review changes', run: mode => env.open(reviewTile(input.directory!), mode) })
    return result
  },
  Setup: ({ state, env, done, enter }) => <OpenCodeSetup connection={state.connection} projects={state.data.snapshot?.projects.length || 0} reconnect={state.reconnect} enter={enter} done={done} openProjects={() => { env.open(projectsTile()); done() }} />,
  Settings: ({ state, env }) => state.connection.enabled ? <OpenCodeSettingsRow state={state} env={env} /> : null,
  Tile({ tile, state, env, visible, focused, focusKey }) {
    const notice = !state.connection.connected && <div className="inline-error">{state.connection.enabled ? state.connection.error || 'OpenCode is not connected.' : 'OpenCode isn’t a source right now.'} Your tile and draft are kept.<button className="text-button" onClick={() => { if (state.connection.enabled) void state.reconnect().catch(e => env.reportError(friendlyError(e))); else env.ask('add opencode') }}>{state.connection.enabled ? 'Reconnect' : 'Add OpenCode'}</button></div>
    const body = tile.kind === 'session' ? <SessionBody tile={tile} state={state} env={env} focused={focused} visible={visible} focusKey={focusKey} />
      : tile.kind === 'project' ? <ProjectBody tile={tile} state={state} env={env} />
      : tile.kind === 'projects' ? <div className="recipe-body"><div className="recipe-toolbar">OpenCode · Projects · rows open independent session-list tiles</div><div className="recipe-content">{state.projects.map(project => <button className="recipe-list-row" key={project.directory} onClick={() => env.open(projectTile(project.directory, project.name))}><strong>{project.name}</strong><small>{project.directory}</small></button>)}</div></div>
      : tile.kind === 'review' ? state.connection.connected && <Review directory={tile.directory || ''} reportError={env.reportError} />
      : <div className="session-details"><h2>{tile.title}</h2><p>{tile.directory}</p><p className="mono">{tile.sessionID}</p></div>
    return <>{notice}{body}</>
  },
  tileStatus: (tile, state) => tile.sessionID ? { running: state.data.active.includes(tile.sessionID), waiting: state.data.waiting.includes(tile.sessionID) } : undefined,
  waiting: (state, env) => state.data.waiting.map(id => ({ key: `session:${id}`, open: () => { const session = state.data.sessions[id]; if (session) env.open(sessionTile(session)); else void opencode.session(id).then(d => { state.data.ingest([d.session]); env.open(sessionTile(d.session)) }).catch(e => env.reportError(friendlyError(e))) } })),
  onShortcut(action, state, env) {
    // Only called when an OpenCode tile is focused.
    if (action !== 'new') return false
    const focused = env.desktop.tiles.find(t => t.id === env.desktop.workspaces.find(w => w.id === env.desktop.activeID)?.focusedID)
    if (!state.connection.connected) env.ask('add opencode')
    else if (focused?.directory) void state.newSession(focused.directory)
    else env.ask('start session in ')
    return true
  },
  contextTargets: state => state.connection.connected ? state.sessions.map(s => ({ id: s.id, title: sessionTitle(s), subtitle: basename(directoryOf(s)), input: sessionTile(s) })) : [],
  acceptsContext: ['session'],
  async rename(tile, title, state) {
    if (tile.kind !== 'session') return false
    state.data.ingest([await opencode.renameSession(tile.sessionID!, title)])
    return true
  },
})

function OpenCodeSettingsRow({ state, env }: { state: OpenCodeState; env: Env }) {
  const [pending, setPending] = useState(false), [status, setStatus] = useState('')
  const where = (u?: string) => { try { return new URL(u || '').host } catch { return u || '' } }
  const run = async (action: () => Promise<void>, done: string) => { setPending(true); setStatus(''); try { await action(); setStatus(done); env.notify(done) } catch (e) { setStatus(friendlyError(e)) } finally { setPending(false) } }
  const c = state.connection
  return <div className="source-row" aria-label="OpenCode source"><span className="k-icon k-icon-opencode md" aria-hidden>oc</span><span><strong>OpenCode</strong><small>{status || (c.connected ? `${where(c.url)} · OpenCode ${c.version || ''}` : c.error || 'Not connected')}</small></span>
    <span className={`status-dot ${c.connected ? 'green' : 'gray'}`} /><button className="text-button" disabled={pending} onClick={() => void run(() => state.reconnect(), 'Reconnected.')}>{c.connected ? 'Reconnect' : 'Connect'}</button><button className="text-button" disabled={pending} onClick={() => void run(state.remove, 'OpenCode removed as a source. Its service and sessions keep running.')}>Remove</button></div>
}
