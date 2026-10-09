import { ArrowUpRight, Globe, Keyboard, Plus, RefreshCw, Settings2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { BrowserContext } from '../shared/types'
import type { ModelInfo } from '../shared/model'
import { sources as catalogue } from '../shared/sources'
import { normalizeURL } from '../shared/util'
import { keyHelp } from '../shared/shortcuts'
import { api, friendlyError } from './data'
import { IconButton, Modal, systemKey } from './ui'
import { ModelSetup } from './Setup'
import { Badge } from './TileOverlays'
import { registry } from './sources/registry'
import type { Env } from './sources/types'


export function AddressDialog({ initial, submit, close }: { initial?: string; submit: (url: string) => void; close: () => void }) {
  const [value, setValue] = useState(initial || '')
  const [error, setError] = useState('')
  return <Modal title="Open URL" close={close}><form className="address-dialog" onSubmit={event => { event.preventDefault(); try { submit(normalizeURL(value)); close() } catch (error) { setError(friendlyError(error)) } }}>
    <div className="modal-heading"><Globe size={17} /><h2>{initial ? 'Go to URL' : 'Open a browser tile'}</h2><IconButton label="Close URL dialog" onClick={close}><X size={16} /></IconButton></div>
    <input className="large-input" autoFocus aria-label="URL" placeholder="localhost:3000 or example.com" value={value} onChange={event => setValue(event.target.value)} onFocus={event => event.target.select()} />
    {error && <div className="error-text">{error}</div>}<div className="button-row"><span className="muted">One URL, one tile. If already open, go to it.</span><button className="pill primary" type="submit">Open <ArrowUpRight size={14} /></button></div>
  </form></Modal>
}

function Appearance() {
  const [mode, setMode] = useState<'system' | 'light' | 'dark'>()
  useEffect(() => { void api.theme().then(setMode).catch(() => {}) }, [])
  return <div className="appearance" role="group" aria-label="Theme">{(['system', 'light', 'dark'] as const).map(m => <button key={m} aria-pressed={mode === m} onClick={() => { void api.theme(m).then(saved => { setMode(saved); window.dispatchEvent(new CustomEvent('chatos-theme', { detail: saved })) }) }}>{m === 'system' ? 'System' : m === 'light' ? 'Light' : 'Dark'}</button>)}</div>
}

export function Settings({ model, modelChanged, env, states, close, platform }: {
  model?: ModelInfo; modelChanged: (info: ModelInfo) => void; env: Env; states: Map<string, unknown>; close: () => void; platform: string;
}) {
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const system = systemKey
  const run = async (action: () => Promise<void>) => { setPending(true); setError(''); try { await action() } catch (e) { setError(friendlyError(e)) } finally { setPending(false) } }
  return <Modal title="Settings" close={close} wide><div className="modal-heading"><Settings2 size={18} /><h2>Settings</h2><span className="muted">{system}+,</span><IconButton label="Close settings" onClick={close}><X size={16} /></IconButton></div>
    <div className="settings-grid">
      <section className="settings-section" aria-label="Appearance"><h3>Appearance</h3><Appearance /></section>
      <section className="settings-section" aria-label="Model"><h3>Model</h3><p className="muted">Powers K: understanding requests, building connectors and mapping tiles. Independent of every source.</p><ModelSetup embedded info={model} firstRun={false} saved={info => { modelChanged(info); setStatus(info.ready ? `Model saved: ${info.model}` : 'Model key forgotten.') }} /></section>
      <section className="settings-section" aria-label="Sources"><h3>Sources</h3>
        <div className="source-list">
          {catalogue.filter(s => s.builtin).map(s => <div className="source-row" key={s.id}><Badge icon={s.id} /><span><strong>{s.name}</strong><small>{s.hint}</small></span><em>built in</em></div>)}
          {registry.map(source => source.Settings && <source.Settings key={source.id} state={states.get(source.id)} env={env} />)}
        </div>
        <div className="button-row"><button className="pill primary" onClick={() => env.ask('add ')}><Plus size={13} />Add a source</button><button className="pill" onClick={() => env.editConnector({})}>Write a connector by hand</button><button className="text-button" disabled={pending} onClick={() => void run(async () => setStatus(`Backup saved: ${await api.backupStorage()}`))}>Create database backup</button></div>
        <p className="muted">Sources you add show up in {systemKey}+K. Nothing is contacted until it is added.</p>
      </section>
      {error && <div className="inline-error" role="alert">{error}</div>}{status && <p className="muted" role="status">{status}</p>}
      <section className="settings-section shortcuts-content" aria-label="Keys"><h3><Keyboard size={15} />Keys</h3><p className="muted">Also anywhere with {system}+/ or ?. {platform === 'darwin' ? '' : 'On Linux, Ctrl+Alt works wherever Super is taken by your window manager.'}</p>{keyHelp(system).map(group => <div key={group.title}><h4>{group.title}</h4>{group.rows.map(row => <div className="shortcut-row" key={row.keys + row.label}><kbd>{row.keys}</kbd><span>{row.label}</span></div>)}</div>)}</section>
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

/** Send a page or selection as context to a tile that takes it, e.g. a coding session's draft. Nothing is sent. */
export function SendPage({ page, targets, send, close }: { page: BrowserContext; targets: { id: string; title: string; subtitle: string }[]; send: (id: string, note: string) => void; close: () => void }) {
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState(targets[0]?.id || '')
  return <Modal title="Send page as context" close={close}><div className="modal-heading"><Globe size={18} /><h2>Send page as context</h2><IconButton label="Close send page dialog" onClick={close}><X size={16} /></IconButton></div><form className="send-page-content" onSubmit={event => { event.preventDefault(); if (!selected) return; send(selected, note); close() }}><strong className="truncate">{page.title || page.url}</strong><span className="muted truncate">{page.url}</span><label className="form-field">To<select aria-label="Destination" value={selected} onChange={event => setSelected(event.target.value)}>{targets.map(t => <option value={t.id} key={t.id}>{t.title} · {t.subtitle}</option>)}</select></label><label className="form-field">Optional note<input aria-label="Page note" value={note} onChange={event => setNote(event.target.value)} placeholder="What should it know?" /></label><div className="button-row"><span className="muted">Adds context to its draft. Nothing is sent.<br />This page stays in its own tile.</span><button className="pill primary" type="submit" disabled={!selected}>Add to draft<kbd aria-hidden>↵</kbd></button></div></form></Modal>
}
