import { useEffect, useState } from 'react'
import type { ConnectionInfo, OpenCodeProbe } from '../../../shared/sources/opencode/types'
import { KChips, KMap, KReply, KRow, ModelRowKeys, type EnterRef } from '../../Setup'
import { friendlyError, opencode } from './state'

const opencodeMap = [
  { resource: 'Project', tile: 'List of sessions', kind: 'built-in' as const, actions: 'Show sessions · Start session · Review changes · Browse files' },
  { resource: 'Session', tile: 'Session tile', kind: 'built-in' as const, actions: 'Open · Continue · Rename' },
  { resource: 'Changes', tile: 'Diff', kind: 'built-in' as const, actions: 'Review' },
]
/** B1/B2: OpenCode is asked for by name. K finds the install and shows how it will appear. */
export function OpenCodeSetup({ connection, projects, reconnect, done, openProjects, enter }: { connection: ConnectionInfo; projects: number; reconnect: (settings?: { url?: string; token?: string }) => Promise<void>; done: () => void; openProjects: () => void; enter?: EnterRef }) {
  const [probe, setProbe] = useState<OpenCodeProbe>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [manual, setManual] = useState(false), [url, setURL] = useState(''), [token, setToken] = useState('')
  const [choice, setChoice] = useState(0)
  useEffect(() => { let valid = true; void opencode.probe().then(p => { if (valid) setProbe(p) }).catch(e => { if (valid) setError(friendlyError(e)) }); return () => { valid = false } }, [])
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); try { await action() } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) } }
  const where = (u?: string) => { try { return new URL(u || '').host } catch { return u || '' } }
  if (connection.connected) {
    if (enter) enter.current = done
    return <div className="k-panel" data-opencode-setup="connected">
      <KReply>Connected to OpenCode on {where(connection.url)}. It has {projects} project{projects === 1 ? '' : 's'}. This is how it will show up:</KReply>
      <KMap rows={opencodeMap} />
      <div className="button-row k-buttons"><button className="pill primary" onClick={done}>Keep<kbd>↵</kbd></button><button className="pill" onClick={openProjects}>Open projects</button><span className="muted">Change later in Super+, → Sources</span></div>
    </div>
  }
  const rows = [
    ...(probe?.running ? [{ key: 'running', title: 'Connect to the running service', subtitle: `${where(probe.running)} · the background service your OpenCode CLI uses`, action: 'Connect', run: () => void run(() => reconnect({})) }] : []),
    ...(probe?.binary && !probe.running ? [{ key: 'start', title: 'Start the background service', subtitle: `opencode serve --service · keeps running for your other OpenCode clients`, action: 'Start and connect', run: () => void run(async () => { await opencode.start(); await reconnect({}) }) }] : []),
    { key: 'url', title: 'Connect to a server URL', subtitle: 'e.g. http://127.0.0.1:4096, or an SSH-forwarded port', action: 'Enter URL', run: () => setManual(true) },
  ]
  const selected = Math.min(choice, rows.length - 1)
  if (enter) enter.current = manual ? () => { if (url.trim()) void run(() => reconnect({ url, token })) } : () => rows[selected]?.run()
  return <div className="k-panel" data-opencode-setup>
    <KReply tone={probe ? 'ok' : 'busy'}>{!probe ? 'Looking for OpenCode on this machine…' : probe.running ? `OpenCode isn’t a source yet. I found its service running at ${where(probe.running)}.` : probe.binary ? `OpenCode isn’t connected. I found OpenCode ${probe.version} installed at ${probe.binary}. How should I reach it?` : 'OpenCode isn’t installed here. Install it from opencode.ai, or connect to a server running elsewhere.'}</KReply>
    <KChips items={[{ label: 'Read projects and sessions', value: 'allow', tone: 'allow' }, { label: 'Start sessions', value: 'only when you ask', tone: 'ask' }, { label: 'File edits', value: 'OpenCode’s own rules' }]} />
    {manual ? <form className="k-fields" onSubmit={e => { e.preventDefault(); void run(() => reconnect({ url, token })) }}>
      <label className="k-field"><span>Server URL</span><span className="k-input"><input aria-label="Server URL" autoFocus placeholder="http://127.0.0.1:4096" value={url} onChange={e => setURL(e.target.value)} /></span></label>
      <label className="k-field"><span>Bearer token (optional)</span><span className="k-input"><input aria-label="Server token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} /></span></label>
      <p className="k-note">HTTP is allowed on localhost only. A token is stored with your system keyring.</p>
      <div className="button-row k-buttons"><button className="pill primary" disabled={busy || !url.trim()} type="submit">{busy ? 'Connecting…' : 'Connect'}</button><button className="text-button" type="button" onClick={() => setManual(false)}>Back</button></div>
    </form> : <div className="k-rows">{rows.map((r, i) => <KRow key={r.key} icon="opencode" title={busy && i === selected ? 'Connecting…' : r.title} source="OpenCode" subtitle={r.subtitle} action={r.action} hint={i === selected ? '↵' : ''} selected={i === selected} disabled={busy || !probe} onClick={() => { setChoice(i); r.run() }} />)}</div>}
    {(error || connection.error) && <p className="k-error" role="alert">{error || connection.error}</p>}
    <ModelRowKeys count={rows.length} move={d => setChoice(c => Math.max(0, Math.min(rows.length - 1, c + d)))} />
  </div>
}

