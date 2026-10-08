import { ArrowUpRight, Globe, Keyboard, Plus, RefreshCw, Settings2, X } from 'lucide-react'
import { useState } from 'react'
import type { BrowserContext, ConnectionInfo, ServiceInfo, SessionInfo } from '../shared/types'
import type { ModelInfo } from '../shared/model'
import type { ConnectorInfo } from '../shared/connectors'
import { sources } from '../shared/sources'
import { basename, directoryOf, normalizeURL, sessionTitle } from '../shared/workspaces'
import { api, friendlyError } from './data'
import { IconButton, Modal } from './ui'
import { ServiceCard } from './ServiceSettings'
import { ModelSetup } from './Setup'
import { Badge } from './TileOverlays'


export function AddressDialog({ initial, submit, close }: { initial?: string; submit: (url: string) => void; close: () => void }) {
  const [value, setValue] = useState(initial || '')
  const [error, setError] = useState('')
  return <Modal title="Open URL" close={close}><form className="address-dialog" onSubmit={event => { event.preventDefault(); try { submit(normalizeURL(value)); close() } catch (error) { setError(friendlyError(error)) } }}>
    <div className="modal-heading"><Globe size={17} /><h2>{initial ? 'Go to URL' : 'Open a browser tile'}</h2><IconButton label="Close URL dialog" onClick={close}><X size={16} /></IconButton></div>
    <input className="large-input" autoFocus aria-label="URL" placeholder="localhost:3000 or example.com" value={value} onChange={event => setValue(event.target.value)} onFocus={event => event.target.select()} />
    {error && <div className="error-text">{error}</div>}<div className="button-row"><span className="muted">One URL, one tile. If already open, go to it.</span><button className="pill primary" type="submit">Open <ArrowUpRight size={14} /></button></div>
  </form></Modal>
}

export function Settings({ model, modelChanged, connection, reconnect, disconnectOpenCode, services, servicesChanged, connectors, manageConnector, addSource, openURL, openFront, close, platform }: {
  model?: ModelInfo; modelChanged: (info: ModelInfo) => void;
  connection: ConnectionInfo; reconnect: () => Promise<void>; disconnectOpenCode: () => Promise<void>;
  services: ServiceInfo[]; servicesChanged: (list: ServiceInfo[]) => void;
  connectors: ConnectorInfo[]; manageConnector: (id?: string) => void; addSource: (query: string) => void;
  openURL: (url: string) => void; openFront: () => void; close: () => void; platform: string;
}) {
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const system = platform === 'darwin' ? '⌘' : 'Super / Ctrl+Alt'
  const run = async (action: () => Promise<void>) => { setPending(true); setError(''); try { await action() } catch (e) { setError(friendlyError(e)) } finally { setPending(false) } }
  const added = services.filter(s => s.configured || s.hasToken)
  const where = (u?: string) => { try { return new URL(u || '').host } catch { return u || '' } }
  return <Modal title="Settings" close={close} wide><div className="modal-heading"><Settings2 size={18} /><h2>Settings</h2><span className="muted">Super+,</span><IconButton label="Close settings" onClick={close}><X size={16} /></IconButton></div>
    <div className="settings-grid">
      <section className="settings-section" aria-label="Model"><h3>Model</h3><p className="muted">Powers K: understanding requests, building connectors and mapping tiles.</p><ModelSetup embedded info={model} firstRun={false} saved={info => { modelChanged(info); setStatus(info.ready ? `Model saved: ${info.model}` : 'Model key forgotten.') }} /></section>
      <section className="settings-section" aria-label="Sources"><h3>Sources</h3>
        <div className="source-list">
          {sources.filter(s => s.builtin).map(s => <div className="source-row" key={s.id}><Badge icon={s.id} /><span><strong>{s.name}</strong><small>{s.hint}</small></span><em>built in</em></div>)}
          {connection.enabled && <div className="source-row" aria-label="OpenCode source"><Badge icon="opencode" /><span><strong>OpenCode</strong><small>{connection.connected ? `${where(connection.url)} · OpenCode ${connection.version || ''}` : connection.error || 'Not connected'}</small></span>
            <span className={`status-dot ${connection.connected ? 'green' : 'gray'}`} /><button className="text-button" disabled={pending} onClick={() => void run(reconnect)}><RefreshCw size={12} />{connection.connected ? 'Reconnect' : 'Connect'}</button><button className="text-button" disabled={pending} onClick={() => void run(async () => { await disconnectOpenCode(); setStatus('OpenCode removed as a source. Its service and sessions keep running.') })}>Remove</button></div>}
          {added.map(service => <details className="source-row-details" key={service.id}><summary className="source-row"><Badge icon={service.id} /><span><strong>{service.name}</strong><small>{service.hasToken ? `${service.account || 'token saved'} · ${service.tokenStorage === 'encrypted' ? 'keyring' : 'this run only'}` : 'no API token'}</small></span><em>manage</em></summary>
            <ServiceCard service={service} openURL={openURL} openFront={service.id === 'front' ? openFront : undefined} update={async () => servicesChanged(await api.services())} />
            <div className="button-row"><button className="text-button" onClick={() => void run(async () => { await api.removeService(service.id); servicesChanged(await api.services()); setStatus(`${service.name} removed. Browser sign-ins are unchanged.`) })}>Remove {service.name} as a source</button></div>
          </details>)}
          {connectors.map(c => <div className="source-row" key={c.definition.id}><Badge icon="connector" /><span><strong>{c.definition.name}</strong><small>{c.definition.baseURL} · v{c.revision} · {c.hasToken ? 'connected' : c.definition.auth.type === 'none' ? 'no auth' : 'needs a token'}</small></span><em>generated</em><button className="text-button" onClick={() => manageConnector(c.definition.id)}>Mapping & auth</button></div>)}
        </div>
        <div className="button-row"><button className="pill primary" onClick={() => addSource('add ')}><Plus size={13} />Add a source</button><button className="pill" onClick={() => manageConnector()}>Write a connector by hand</button><button className="text-button" disabled={pending} onClick={() => void run(async () => setStatus(`Backup saved: ${await api.backupStorage()}`))}>Create database backup</button></div>
        <p className="muted">Sources you add show up in Super+K. Nothing is contacted until it is added.</p>
      </section>
      {error && <div className="inline-error" role="alert">{error}</div>}{status && <p className="muted" role="status">{status}</p>}
      <section className="settings-section shortcuts-content" aria-label="Keys"><h3><Keyboard size={15} />Keys</h3>{[[`${system}+K · Ctrl+K`, 'Open K: search, ask, or add a source'], ['↵ / ⌃↵ / → / Tab in K', 'Run here / new workspace / other actions / narrow to a source'], [`${system}+T`, 'Terminal in the focused folder'], [`${system}+,`, 'Settings'], [`${system}+0–9`, 'Workspace by number'], [`${system}+Shift+1–9`, 'Move tile and linked previews'], [`${system}+arrows · H/J/L`, 'Focus neighbour'], [`${system}+Shift+arrows`, 'Swap with neighbour'], [`${system}+Enter / F`, 'Promote / fullscreen focused tile'], [`${system}+− / =`, 'Shelf / restore last shelved tile'], [`${system}+Shift+Q`, 'Close tile'], [`${system}+U`, 'Go to waiting session'], [`${system}+Z`, 'Undo what K just arranged'], ['Ctrl+L / Ctrl+T', 'Address / new browser tile'], ['Ctrl+.', 'Selection to a session draft (never sends)']].map(([key, title]) => <div className="shortcut-row" key={key}><kbd>{key}</kbd><span>{title}</span></div>)}<p className="muted">On Linux, use Ctrl+Alt if your window manager captures Super.</p></section>
    </div>
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
