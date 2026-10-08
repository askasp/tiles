import { ArrowLeft, ArrowUpRight, Check, FolderOpen, Globe, Home as HomeIcon, Keyboard, LayoutGrid, Plus, RefreshCw, Search, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserContext, ConnectionInfo, ServiceInfo, SessionInfo, Workspace } from '../shared/types'
import { basename, directoryOf, normalizeURL, sessionTitle } from '../shared/workspaces'
import { api, friendlyError } from './data'
import type { ProjectEntry } from './Home'
import { IconButton, Modal, ProjectBadge, Status, shortPath } from './ui'
import { ServiceSettings } from './ServiceSettings'

const isURL = (value: string) => /^(https?:\/\/|localhost[:/]|127\.0\.0\.1[:/]|\[::1\])|^[^\s/]+\.[^\s]+$/.test(value.trim())

export function Launcher({ sessions, projects, workspaces, openSession, chooseProject, openURL, newSession, reopen, close, reportError, activeSession }: {
  sessions: SessionInfo[]; projects: ProjectEntry[]; workspaces: Workspace[];
  openSession: (session: SessionInfo) => void; chooseProject: (project: ProjectEntry) => void;
  openURL: (url: string, inSession?: boolean) => void; newSession: (draft?: string) => void;
  reopen: (workspace: Workspace) => void; close: () => void; reportError: (message: string) => void; activeSession?: string;
}) {
  const [query, setQuery] = useState('')
  const [remoteSessions, setRemoteSessions] = useState<SessionInfo[] | null>(null)
  const [index, setIndex] = useState(0)
  const url = isURL(query)
  useEffect(() => {
    if (!query.trim() || url) { setRemoteSessions(null); return }
    let current = true
    const timer = setTimeout(() => { void api.sessions({ search: query }).then(page => { if (current) setRemoteSessions(page.data) }).catch(() => {}) }, 200)
    return () => { current = false; clearTimeout(timer) }
  }, [query, url])
  const matches = (remoteSessions || sessions).filter(session => sessionTitle(session).toLowerCase().includes(query.toLowerCase())).slice(0, 8)
  const projectMatches = projects.filter(project => `${project.name} ${project.directory}`.toLowerCase().includes(query.toLowerCase())).slice(0, query ? 4 : 2)
  const hiddenBrowsers = workspaces.filter(w => w.hidden && w.kind === 'web' && w.title.toLowerCase().includes(query.toLowerCase())).slice(0, 3)
  const actions = useMemo(() => [
    ...(url ? [{ label: query, description: 'New web workspace · not linked to a session', icon: 'web', run: () => openURL(query), key: '↵' },
      ...(activeSession ? [{ label: 'Open in this session’s browser', description: 'As a tab on its stage', icon: 'web', run: () => openURL(query, true), key: 'Shift+↵' }] : [])] : []),
    ...matches.map(session => ({ label: sessionTitle(session), description: basename(directoryOf(session)), icon: 'session', run: () => openSession(session), key: '' })),
    ...projectMatches.map(project => ({ label: project.name, description: project.directory, icon: 'project', run: () => chooseProject(project), key: '' })),
    ...hiddenBrowsers.map(workspace => ({ label: `Reopen ${workspace.title}`, description: 'Hidden browser workspace', icon: 'web', run: () => reopen(workspace), key: '' })),
    { label: query && !url ? `New session: “${query}”` : 'New session', description: 'A new workspace in your selected project', icon: 'new', run: () => newSession(url ? undefined : query), key: '' },
  ], [url, query, activeSession, matches, projectMatches, hiddenBrowsers, openURL, openSession, chooseProject, reopen, newSession])
  const execute = (i: number) => { try { actions[i]?.run(); close() } catch (error) { reportError(friendlyError(error)) } }
  return <Modal title="Launcher" close={close}>
    <div className="launcher-input"><Search size={18} /><input autoFocus aria-label="Launcher search" placeholder="Jump to a session, project, or URL…" value={query} onChange={event => { setQuery(event.target.value); setIndex(0) }} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length) }
      if (event.key === 'Enter') { event.preventDefault(); if (url && event.shiftKey && activeSession) execute(1); else execute(Math.min(index, actions.length - 1)) }
    }} /><kbd>esc</kbd></div>
    <div className="launcher-results">{actions.map((action, i) => <button className={`launcher-result ${i === index ? 'selected' : ''}`} key={`${action.label}-${i}`} onMouseEnter={() => setIndex(i)} onClick={() => execute(i)}>
      <span className="launcher-result-icon">{action.icon === 'web' ? <Globe size={17} /> : action.icon === 'new' ? <Plus size={17} /> : action.icon === 'project' ? <FolderOpen size={17} /> : <ProjectBadge name={action.description} small />}</span>
      <span className="launcher-result-copy"><strong className="truncate">{action.label}</strong><small className="truncate">{action.description}</small></span><kbd>{action.key || (i === index ? '↵' : '')}</kbd>
    </button>)}</div><footer className="modal-footer">↑ ↓ move · ↵ open · Esc dismiss<span>Nothing is sent until you press Send.</span></footer>
  </Modal>
}

export function AddressDialog({ initial, submit, close }: { initial?: string; submit: (url: string) => void; close: () => void }) {
  const [value, setValue] = useState(initial || '')
  const [error, setError] = useState('')
  return <Modal title="Open URL" close={close}><form className="address-dialog" onSubmit={event => { event.preventDefault(); try { submit(normalizeURL(value)); close() } catch (error) { setError(friendlyError(error)) } }}>
    <div className="modal-heading"><Globe size={17} /><h2>{initial ? 'Go to URL' : 'Open a browser tile'}</h2><IconButton label="Close URL dialog" onClick={close}><X size={16} /></IconButton></div>
    <input className="large-input" autoFocus aria-label="URL" placeholder="localhost:3000 or example.com" value={value} onChange={event => setValue(event.target.value)} onFocus={event => event.target.select()} />
    {error && <div className="error-text">{error}</div>}<div className="button-row"><span className="muted">One URL, one tile. If already open, go to it.</span><button className="pill primary" type="submit">Open <ArrowUpRight size={14} /></button></div>
  </form></Modal>
}

export function Overview({ workspaces, activeID, activeSessions, goHome, reopen, hide, close }: {
  workspaces: Workspace[]; activeID: string; activeSessions: string[]; goHome: () => void;
  reopen: (workspace: Workspace) => void; hide: (id: string) => void; close: () => void;
}) {
  const [showHidden, setShowHidden] = useState(false)
  const visible = workspaces.filter(w => showHidden || !w.hidden)
  return <Modal title="Workspace overview" close={close} wide>
    <div className="modal-heading"><LayoutGrid size={19} /><h2>Overview</h2><span className="muted">{workspaces.filter(w => !w.hidden).length} open workspaces</span><IconButton label="Close overview" onClick={close}><X size={16} /></IconButton></div>
    <div className="overview-grid"><button className={`overview-card ${activeID === 'home' ? 'selected' : ''}`} onClick={() => { goHome(); close() }}><div className="workspace-preview home-preview"><HomeIcon size={30} strokeWidth={1.2} /><span>Projects & sessions</span></div><div className="overview-card-title"><strong>Home</strong><kbd>0</kbd></div></button>
      {visible.map(workspace => <div className={`overview-card ${workspace.id === activeID ? 'selected' : ''} ${workspace.hidden ? 'hidden-workspace' : ''}`} key={workspace.id}>
        <button className="overview-open" onClick={() => { reopen(workspace); close() }}><span className="workspace-preview">{workspace.kind === 'session' && <span className="preview-chat"><i /><i /><i /><b /></span>}<span className="preview-stage">{workspace.tabs.length ? workspace.tabs.map(tab => <span key={tab.id}>{tab.kind === 'browser' ? <Globe size={13} /> : <LayoutGrid size={13} />}{tab.title}</span>) : <span>Empty stage</span>}</span></span>
          <span className="overview-card-title"><strong className="truncate">{workspace.title}</strong><Status running={!!workspace.sessionID && activeSessions.includes(workspace.sessionID)} /></span><span className="overview-card-subtitle">{workspace.hidden ? 'Hidden · click to reopen' : workspace.kind === 'web' ? 'Web · no session' : basename(workspace.directory || '')}</span>
        </button>{!workspace.hidden && <IconButton label={`Hide ${workspace.title}`} className="overview-close" onClick={() => hide(workspace.id)}><X size={13} /></IconButton>}
      </div>)}</div>
    <footer className="modal-footer"><label className="show-hidden"><input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)} />Show hidden workspaces</label><span>Closing only hides. Sessions keep running.</span></footer>
  </Modal>
}

export function ConnectionSettings({ connection, platform, reconnect, close, reportError, openURL, servicesChanged, openFront, manageConnectors }: {
  connection: ConnectionInfo; platform: string; reconnect: (settings: { url?: string; token?: string }) => Promise<void>;
  close: () => void; reportError: (message: string) => void;
  openURL?: (url: string) => void; servicesChanged?: (services: ServiceInfo[]) => void;
  openFront?: () => void;
  manageConnectors?: () => void;
}) {
  const [automatic, setAutomatic] = useState(connection.automatic)
  const [url, setURL] = useState(connection.automatic ? '' : connection.url || '')
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const system = platform === 'darwin' ? '⌘' : 'Super / Ctrl+Alt'
  return <Modal title="Connection and shortcuts" close={close}><div className="modal-heading"><Settings size={18} /><h2>Connection & shortcuts</h2><IconButton label="Close settings" onClick={close}><X size={16} /></IconButton></div>
    <form className="settings-content" onSubmit={event => { event.preventDefault(); setPending(true); void reconnect(automatic ? {} : { url, token }).catch(error => reportError(friendlyError(error))).finally(() => setPending(false)) }}>
      <div className="connection-summary"><span className={`status-dot ${connection.connected ? 'green' : 'amber'}`} /><strong>{connection.connected ? `OpenCode ${connection.version}` : 'Not connected'}</strong><span className="mono truncate">{connection.url || 'Local service'}</span></div>
      {connection.error && <div className="inline-error">{connection.error}</div>}
      <label className="checkbox-label"><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />Discover the local OpenCode 2 service automatically</label>
      {!automatic && <><label className="form-field">Server URL<input aria-label="Server URL" placeholder="http://127.0.0.1:49374" value={url} onChange={event => setURL(event.target.value)} required /></label><label className="form-field">Bearer token (optional)<input type="password" aria-label="Server token" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label><small className="muted">Credentials stay in the main process for this run. They aren’t saved.</small></>}
      <div className="button-row"><span className="muted">Your existing server is never restarted.</span><button className="pill primary" disabled={pending} type="submit"><RefreshCw size={13} />{pending ? 'Connecting…' : 'Reconnect'}</button></div>
    </form>
    {openURL && <ServiceSettings openURL={openURL} onChange={servicesChanged || (() => {})} openFront={openFront} />}
    {manageConnectors && <div className="settings-content"><button className="pill" onClick={manageConnectors}>Add / manage source · tile recipes & storage</button></div>}
    <div className="shortcuts-content"><h3><Keyboard size={15} />Tile keys</h3>{[[`${system}+K / Space · Ctrl+K`, 'Find or open'], ['Enter / Shift+Enter / Ctrl+Enter in K', 'Open or go / move here / new workspace'], [`${system}+0–9`, 'Home / stable workspace number'], [`${system}+Shift+1–9`, 'Move tile and linked previews'], [`${system}+arrows · H/J/L`, 'Focus spatial neighbour (K reserved for launcher)'], [`${system}+Shift+arrows`, 'Swap with neighbour'], [`${system}+Enter / F`, 'Promote / fullscreen focused tile'], [`${system}+− / =`, 'Shelf / restore last shelved tile'], [`${system}+Shift+Q`, 'Close locally; session keeps running'], [`${system}+U`, 'Go to waiting session, including shelf'], [`${system}+Z`, 'Undo arrangement (doesn’t revert drafts)'], ['Ctrl+L / Ctrl+T', 'Address / new browser tile'], ['Ctrl+.', 'Selection to a session draft (never sends)']].map(([key, title]) => <div className="shortcut-row" key={key}><kbd>{key}</kbd><span>{title}</span></div>)}<p className="muted">On Linux, use Ctrl+Alt if your window manager captures Super. Text undo stays Ctrl+Z; arrangement undo is Super+Z (or Ctrl+Z in an empty launcher).</p></div>
  </Modal>
}

export function RenameDialog({ title, submit, close, label = 'Session name' }: { title: string; submit: (title: string) => Promise<void>; close: () => void; label?: string }) {
  const [value, setValue] = useState(title)
  const [pending, setPending] = useState(false)
  return <Modal title={label} close={close}><form className="address-dialog" onSubmit={event => { event.preventDefault(); setPending(true); void submit(value).finally(() => setPending(false)) }}>
    <div className="modal-heading"><h2>{label === 'Session name' ? 'Rename session' : 'Name this tile'}</h2><IconButton label="Close rename dialog" onClick={close}><X size={16} /></IconButton></div><input className="large-input" aria-label={label} autoFocus value={value} onFocus={event => event.target.select()} onChange={event => setValue(event.target.value)} /><div className="button-row"><button type="button" className="pill" onClick={close}>Cancel</button><button className="pill primary" disabled={pending || !value.trim()} type="submit">Save name</button></div>
  </form></Modal>
}

export function SendPage({ page, sessions, send, close }: { page: BrowserContext; sessions: SessionInfo[]; send: (session: SessionInfo, note: string) => void; close: () => void }) {
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState(sessions[0]?.id || '')
  return <Modal title="Send page to session" close={close}><div className="modal-heading"><Globe size={18} /><h2>Send page to a session</h2><IconButton label="Close send page dialog" onClick={close}><X size={16} /></IconButton></div><div className="send-page-content"><strong className="truncate">{page.title || page.url}</strong><span className="muted truncate">{page.url}</span><label className="form-field">Session<select aria-label="Destination session" value={selected} onChange={event => setSelected(event.target.value)}>{sessions.map(session => <option value={session.id} key={session.id}>{sessionTitle(session)} · {basename(directoryOf(session))}</option>)}</select></label><label className="form-field">Optional note<input aria-label="Page note" value={note} onChange={event => setNote(event.target.value)} placeholder="What should the agent know?" /></label><div className="button-row"><span className="muted">Adds context to its draft. Nothing is sent.<br />This browser stays in its own workspace.</span><button className="pill primary" disabled={!selected} onClick={() => { const session = sessions.find(s => s.id === selected); if (session) { send(session, note); close() } }}>Add to draft</button></div></div></Modal>
}
