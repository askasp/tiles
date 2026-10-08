import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import type { ConnectionInfo, OpenCodeProbe, ServiceID, ServiceInfo } from '../shared/types'
import { isLoopbackURL, localModelURL, type DiscoveryResult, type DiscoveryTurn, type ModelInfo, type ModelProbe } from '../shared/model'
import { recipeTile, type TileInput } from '../shared/tiles'
import type { ConnectorDefinition, ConnectorInfo } from '../shared/connectors'
import { api, friendlyError } from './data'

/** K panels write their ↵ action here, so Enter in the K input runs it. */
export type EnterRef = MutableRefObject<(() => void) | undefined>

export function KReply({ children, tone = 'ok' }: { children: ReactNode; tone?: 'ok' | 'busy' | 'warn' }) {
  return <div className="k-reply" role="status"><span className={`k-reply-dot ${tone}`} /><span>{children}</span></div>
}
export function KChips({ items }: { items: { label: string; value: string; tone?: 'allow' | 'ask' | 'plain' }[] }) {
  return <div className="k-chips">{items.map(c => <span className="k-chip" key={c.label}>{c.label}<b className={c.tone || 'plain'}>{c.value}</b></span>)}</div>
}
export function KMap({ rows }: { rows: { resource: string; tile: string; kind: 'built-in' | 'generated'; actions: string }[] }) {
  return <div className="k-map" role="table" aria-label="How this source shows up"><div className="k-map-row head" role="row"><span>Resource</span><span>Opens as</span><span>Actions</span></div>
    {rows.map(r => <div className="k-map-row" role="row" key={r.resource}><strong>{r.resource}</strong><span>{r.tile}<i className={r.kind}>{r.kind}</i></span><span className="muted">{r.actions}</span></div>)}</div>
}
export function KRow({ icon, title, source, subtitle, action, hint, selected, disabled, onClick, label }: { icon: string; title: string; source: string; subtitle?: string; action: string; hint?: string; selected?: boolean; disabled?: boolean; onClick: () => void; label?: string }) {
  return <button type="button" aria-label={label || title} className={`launcher-result k-row ${selected ? 'selected' : ''}`} disabled={disabled} onClick={onClick}>
    <span className={`k-icon k-icon-${icon}`}>{iconText[icon] || icon.slice(0, 2)}</span>
    <span className="launcher-result-copy"><strong className="truncate">{title}</strong><span className="k-meta"><span className="k-source">{source}</span>{subtitle && <small className="truncate">{subtitle}</small>}</span></span>
    <span className="k-action">{action}</span><kbd className="k-key">{hint || ''}</kbd>
  </button>
}
export const iconText: Record<string, string> = { ai: 'ai', web: '↗', files: '/', file: '·', terminal: '>_', opencode: 'oc', front: 'fr', slack: 'sl', github: 'gh', search: '?', connector: '◇', add: '+', session: 'oc', tile: '▢' }

const nonChat = /embed|whisper|tts|dall-e|moderation|audio|image|transcri|realtime|search|rerank|vision-preview/i
export function preferredModel(models: string[], current?: string) {
  if (current && models.includes(current)) return current
  return models.find(m => !nonChat.test(m)) || models[0] || ''
}

/** A0: the one thing first launch asks for. Any OpenAI-compatible endpoint, or a local model. */
export interface ViaOpenCode { connection: ConnectionInfo; reconnect: (settings?: { url?: string; token?: string }) => Promise<void>; home: string; signIn: (command: string) => void }
export function ModelSetup({ info, firstRun, saved, skip, enter, embedded, opencode }: { info?: ModelInfo; firstRun: boolean; saved: (info: ModelInfo) => void; skip?: () => void; enter?: EnterRef; embedded?: boolean; opencode?: ViaOpenCode }) {
  const [via, setVia] = useState<'api' | 'opencode'>(info?.provider === 'opencode' ? 'opencode' : 'api')
  if (via === 'opencode' && opencode) return <OpenCodeModelSetup info={info} firstRun={firstRun} saved={saved} skip={skip} enter={enter} embedded={embedded} opencode={opencode} back={() => setVia('api')} />
  return <APIModelSetup info={info} firstRun={firstRun} saved={saved} skip={skip} enter={enter} embedded={embedded} subscription={opencode ? () => setVia('opencode') : undefined} />
}
function APIModelSetup({ info, firstRun, saved, skip, enter, embedded, subscription }: { info?: ModelInfo; firstRun: boolean; saved: (info: ModelInfo) => void; skip?: () => void; enter?: EnterRef; embedded?: boolean; subscription?: () => void }) {
  const [baseURL, setBaseURL] = useState(info?.configured && info.provider !== 'opencode' ? info.baseURL : 'https://api.openai.com/v1')
  const [apiKey, setAPIKey] = useState('')
  const [model, setModel] = useState(info?.provider === 'opencode' ? '' : info?.model || '')
  const [probe, setProbe] = useState<ModelProbe>()
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [choice, setChoice] = useState(0)
  const version = useRef(0)
  const local = isLoopbackURL(baseURL)
  const keyKnown = Boolean(apiKey.trim() || (info?.configured && info.baseURL === baseURL.replace(/\/$/, '') && info.tokenStorage !== 'none'))
  useEffect(() => {
    const current = ++version.current
    setProbe(undefined); setError('')
    if (!baseURL.trim() || (!keyKnown && !local)) { setChecking(false); return }
    setChecking(true)
    const timer = setTimeout(() => {
      void api.probeModel({ baseURL, ...(apiKey.trim() && { apiKey }) }).then(result => {
        if (current !== version.current) return
        setProbe(result); setModel(m => preferredModel(result.models, m))
      }).catch(e => { if (current === version.current) setError(friendlyError(e)) }).finally(() => { if (current === version.current) setChecking(false) })
    }, 450)
    return () => clearTimeout(timer)
  }, [baseURL, apiKey, keyKnown, local])
  const connect = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { const result = await api.saveModel({ baseURL, model, ...(apiKey.trim() && { apiKey }) }); setAPIKey(''); saved(result) }
    catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  const useLocal = () => { setBaseURL(localModelURL); setAPIKey(''); setModel(''); setChoice(0) }
  const canConnect = Boolean(model.trim() && baseURL.trim() && (keyKnown || local) && !busy)
  const rows = [
    { key: 'connect', icon: 'ai', title: busy ? 'Connecting…' : 'Connect', source: 'Model', subtitle: model ? `${model} · checks the key and saves it` : 'pick a model once the key is checked', action: 'Connect', run: () => void connect(), disabled: !canConnect },
    ...(!local ? [{ key: 'local', icon: 'ai', title: 'Use a local model instead', source: 'Model', subtitle: `e.g. Ollama at ${localModelURL}, no key`, action: 'Set up', run: useLocal, disabled: false }] : [{ key: 'remote', icon: 'ai', title: 'Use a hosted endpoint instead', source: 'Model', subtitle: 'OpenAI, OpenRouter, Groq, Together… any OpenAI-compatible API', action: 'Set up', run: () => { setBaseURL('https://api.openai.com/v1'); setModel('') }, disabled: false }]),
    ...(subscription ? [{ key: 'subscription', icon: 'opencode', title: 'Use your ChatGPT subscription', source: 'OpenCode', subtitle: 'or any model your OpenCode is signed into · no API key needed', action: 'Set up', run: subscription, disabled: false }] : []),
    ...(skip ? [{ key: 'skip', icon: 'tile', title: 'Skip for now', source: 'Built in', subtitle: 'Browser, Files and Terminal work without a model. Super+K → “model” sets it up later.', action: 'Skip', run: skip, disabled: false }] : []),
  ]
  const selected = Math.min(choice, rows.length - 1)
  if (enter) enter.current = () => { const row = canConnect && selected === 0 ? rows[0] : rows[selected]; if (!row.disabled) row.run() }
  return <div className="k-panel" data-model-setup>
    {!embedded && <KReply>{firstRun ? 'K uses an AI model to understand what you ask, find things and build connectors. Any OpenAI-compatible endpoint works.' : info?.ready ? `Connected to ${info.model}. Change the endpoint, key or model below.` : 'Connect a model so K can build connectors and plan across your sources.'}</KReply>}
    <div className="k-fields">
      <label className="k-field"><span>Base URL</span><span className="k-input"><input aria-label="Model base URL" value={baseURL} spellCheck={false} onChange={e => setBaseURL(e.target.value)} /></span></label>
      {!local && <label className="k-field"><span>API key</span><span className="k-input"><input aria-label="Model API key" type="password" autoComplete="off" spellCheck={false} value={apiKey} placeholder={keyKnown ? 'Saved · paste a new key to replace it' : 'sk-…'} onChange={e => setAPIKey(e.target.value)} /><em className={error ? 'bad' : 'good'}>{checking ? 'checking…' : error ? '' : probe ? `✓ ${probe.models.length} model${probe.models.length === 1 ? '' : 's'} found` : ''}</em></span></label>}
      {local && <p className="k-note">{checking ? 'Looking for your local model server…' : probe ? `✓ ${probe.models.length} local model${probe.models.length === 1 ? '' : 's'} found` : 'Start Ollama (ollama serve), LM Studio or llama.cpp with an OpenAI-compatible endpoint.'}</p>}
      <label className="k-field"><span>Model</span><span className="k-input">{probe?.models.length ? <select aria-label="Model" value={model} onChange={e => setModel(e.target.value)}>{!probe.models.includes(model) && model && <option value={model}>{model}</option>}{probe.models.map(m => <option key={m} value={m}>{m}</option>)}</select> : <input aria-label="Model" value={model} spellCheck={false} placeholder="Model ID, e.g. gpt-4.1-mini" onChange={e => setModel(e.target.value)} />}</span></label>
      {error && <p className="k-error" role="alert">{error}</p>}
      <p className="k-note">{local ? 'Runs on this machine. Nothing leaves it.' : 'The key is stored with your system keyring. What you type in K goes to this endpoint; service tokens never do.'} Change it later in Super+, → Model.</p>
    </div>
    <KChips items={[{ label: 'Model', value: model || '—' }, { label: 'Used for', value: 'Super+K, connectors, tile mapping' }]} />
    {!embedded ? <div className="k-rows">{rows.map((r, i) => <KRow key={r.key} icon={r.icon} title={r.title} source={r.source} subtitle={r.subtitle} action={r.action} hint={i === selected ? '↵' : ''} selected={i === selected} disabled={r.disabled} onClick={() => { setChoice(i); r.run() }} />)}</div>
      : <div className="button-row k-buttons"><button className="pill primary" disabled={!canConnect} onClick={() => void connect()}>{busy ? 'Connecting…' : info?.ready ? 'Save model' : 'Connect model'}</button>{!local && <button className="pill" onClick={useLocal}>Use a local model</button>}{subscription && <button className="pill" onClick={subscription}>Use ChatGPT subscription</button>}{info?.tokenStorage !== 'none' && info?.ready && <button className="text-button" onClick={() => void api.forgetModelKey().then(saved).catch(e => setError(friendlyError(e)))}>Forget key</button>}</div>}
    {!embedded && <ModelRowKeys count={rows.length} move={d => setChoice(c => Math.max(0, Math.min(rows.length - 1, c + d)))} />}
  </div>
}
/** ↑/↓ choose a row in a setup panel while focus stays in the K input. */
function ModelRowKeys({ count, move }: { count: number; move: (delta: number) => void }) {
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (!(e.target instanceof HTMLInputElement) || e.target.getAttribute('aria-label') !== 'Launcher search') return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1) }
    }
    document.addEventListener('keydown', keys, true)
    return () => document.removeEventListener('keydown', keys, true)
  }, [count, move])
  return null
}

/** K through OpenCode: whatever OpenCode is signed into, including a ChatGPT Plus/Pro subscription. */
function OpenCodeModelSetup({ info, firstRun, saved, skip, enter, embedded, opencode, back }: { info?: ModelInfo; firstRun: boolean; saved: (info: ModelInfo) => void; skip?: () => void; enter?: EnterRef; embedded?: boolean; opencode: ViaOpenCode; back: () => void }) {
  const [models, setModels] = useState<{ value: string; name: string }[]>()
  const [model, setModel] = useState(info?.provider === 'opencode' ? info.model : '')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [generation, setGeneration] = useState(0)
  const connected = opencode.connection.connected
  useEffect(() => {
    if (!connected) return
    let valid = true
    setModels(undefined); setError('')
    void api.catalog(opencode.home || '/').then(c => {
      if (!valid) return
      const list = c.models.filter(m => m.enabled).map(m => ({ value: `${m.providerID}/${m.id}`, name: `${m.name || m.id} · ${m.providerID}` }))
        .sort((a, b) => Number(b.value.startsWith('openai/')) - Number(a.value.startsWith('openai/')) || a.value.localeCompare(b.value))
      setModels(list)
      setModel(current => list.some(m => m.value === current) ? current : list.find(m => m.value.startsWith('openai/') && !/fast|spark|mini/.test(m.value))?.value || list[0]?.value || '')
    }).catch(e => { if (valid) setError(friendlyError(e)) })
    return () => { valid = false }
  }, [connected, opencode.home, generation])
  const connect = async () => {
    if (busy || !model) return
    setBusy(true); setError('')
    try { saved(await api.saveModel({ provider: 'opencode', baseURL: '', model })) } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  if (!connected) return <div className="k-panel" data-model-setup>
    <KReply>K can use the models your OpenCode is signed into, including a ChatGPT Plus or Pro subscription. First, connect OpenCode:</KReply>
    <OpenCodeSetup connection={opencode.connection} projects={0} reconnect={opencode.reconnect} enter={enter} done={() => {}} openProjects={() => {}} />
    <div className="button-row k-buttons"><button className="text-button" onClick={back}>Use an API key instead</button>{skip && <button className="text-button" onClick={skip}>Skip for now</button>}</div>
  </div>
  const openai = models?.some(m => m.value.startsWith('openai/'))
  if (enter) enter.current = () => void connect()
  return <div className="k-panel" data-model-setup="opencode">
    {!embedded && <KReply>{models === undefined ? 'Reading the models OpenCode can use…' : openai ? 'These come from OpenCode’s sign-ins. OpenAI models use your ChatGPT subscription if that is how OpenCode signed in.' : 'OpenCode has no OpenAI sign-in yet. Sign in with your ChatGPT account in a terminal, then refresh.'}</KReply>}
    <div className="k-fields">
      <label className="k-field"><span>Model through OpenCode</span><span className="k-input">{models?.length ? <select aria-label="OpenCode model" value={model} onChange={e => setModel(e.target.value)}>{models.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}</select> : <input aria-label="OpenCode model" disabled value={models ? 'No models available' : 'Loading…'} readOnly />}<em className="good">{models?.length ? `✓ ${models.length} models` : ''}</em></span></label>
      <p className="k-note">ChatGPT subscription: run <code>opencode auth login</code>, choose OpenAI, then ChatGPT Plus/Pro. Nothing extra is stored in ChatOS.</p>
      {error && <p className="k-error" role="alert">{error}</p>}
    </div>
    <div className="button-row k-buttons"><button className="pill primary" disabled={busy || !model} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Use this model'}{!embedded && <kbd>↵</kbd>}</button><button className="pill" onClick={() => opencode.signIn('opencode auth login')}>Sign in to ChatGPT in a terminal</button><button className="text-button" onClick={() => setGeneration(g => g + 1)}>Refresh</button><button className="text-button" onClick={back}>Use an API key instead</button>{skip && <button className="text-button" onClick={skip}>Skip for now</button>}</div>
  </div>
}

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
  useEffect(() => { let valid = true; void api.opencodeProbe().then(p => { if (valid) setProbe(p) }).catch(e => { if (valid) setError(friendlyError(e)) }); return () => { valid = false } }, [])
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
    ...(probe?.binary && !probe.running ? [{ key: 'start', title: 'Start the background service', subtitle: `opencode serve --service · keeps running for your other OpenCode clients`, action: 'Start and connect', run: () => void run(async () => { await api.opencodeStart(); await reconnect({}) }) }] : []),
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

const serviceCopy: Record<ServiceID, { intro: string; scopes: string; map: { resource: string; tile: string; kind: 'built-in' | 'generated'; actions: string }[]; chips: { label: string; value: string; tone?: 'allow' | 'ask' | 'plain' }[] }> = {
  front: {
    intro: 'Front has a public API. Paste an API token from Front: Settings → Developers → API tokens.',
    scopes: 'Needs conversations:read and messages:read. Private inboxes need API access from an admin.',
    map: [{ resource: 'Inbox', tile: 'List of conversations', kind: 'built-in', actions: 'Show conversations · Filter · Search' }, { resource: 'Conversation', tile: 'Conversation', kind: 'built-in', actions: 'Read · Open in Front to reply' }],
    chips: [{ label: 'Read conversations', value: 'allow', tone: 'allow' }, { label: 'Reply to customers', value: 'in Front’s own page', tone: 'ask' }],
  },
  slack: {
    intro: 'Slack needs a user token (xoxp-…) from a Slack app you install: OAuth & Permissions → User Token.',
    scopes: 'users:read + im:read find existing DMs; search:read finds messages and mentions.',
    map: [{ resource: 'DM', tile: 'Slack page in a Browser tile', kind: 'built-in', actions: 'Find existing DM · never creates one' }, { resource: 'Mentions', tile: 'Search results', kind: 'built-in', actions: 'Open in Browser' }],
    chips: [{ label: 'Find DMs and mentions', value: 'allow', tone: 'allow' }, { label: 'Send messages', value: 'only in Slack’s page', tone: 'ask' }],
  },
  github: {
    intro: 'GitHub uses a personal access token: Settings → Developer settings → Fine-grained tokens, read access to the repositories you review.',
    scopes: 'Pull requests: read. Search runs only when you ask.',
    map: [{ resource: 'Pull request', tile: 'GitHub page in a Browser tile', kind: 'built-in', actions: 'Review requested · Search' }],
    chips: [{ label: 'Read pull requests', value: 'allow', tone: 'allow' }, { label: 'Comment, merge', value: 'only in GitHub’s page', tone: 'ask' }],
  },
}
/** D1/D2: a service with a ChatOS adapter, connected with a token. */
export function ServiceSetup({ id, service, changed, done, openFront, enter }: { id: ServiceID; service?: ServiceInfo; changed: (list: ServiceInfo[]) => void; done: () => void; openFront: () => void; enter?: EnterRef }) {
  const copy = serviceCopy[id]
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [account, setAccount] = useState(service?.hasToken ? service.account || 'saved token' : '')
  const name = id === 'github' ? 'GitHub' : id === 'front' ? 'Front' : 'Slack'
  const connect = async () => {
    if (busy || !token.trim()) return
    setBusy(true); setError('')
    try {
      await api.saveService({ id, token })
      setToken('')
      const result = await api.validateService(id)
      changed(await api.services())
      if (!result.ok) throw new Error(result.error || 'The token could not be verified')
      setAccount(result.account || 'verified')
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  if (account) {
    if (enter) enter.current = done
    return <div className="k-panel" data-service-setup={id}>
      <KReply>Connected to {name} as {account}. This is how it will show up:</KReply>
      <KMap rows={copy.map} />
      <div className="button-row k-buttons"><button className="pill primary" onClick={done}>Keep<kbd>↵</kbd></button>{id === 'front' && <button className="pill" onClick={openFront}>Open inbox</button>}<button className="text-button" onClick={() => setAccount('')}>Replace token</button></div>
    </div>
  }
  if (enter) enter.current = () => void connect()
  return <div className="k-panel" data-service-setup={id}>
    <KReply>{copy.intro}</KReply>
    <form className="k-fields" onSubmit={e => { e.preventDefault(); void connect() }}>
      <label className="k-field"><span>API token</span><span className="k-input"><input aria-label={`${name} API token`} type="password" autoComplete="off" spellCheck={false} autoFocus value={token} onChange={e => setToken(e.target.value)} /><em className="good">{busy ? 'checking…' : ''}</em></span></label>
      <p className="k-note">{copy.scopes} Stored in your system keyring, never sent anywhere except {name}.</p>
      {error && <p className="k-error" role="alert">{error}</p>}
    </form>
    <KChips items={copy.chips} />
    <div className="k-rows"><KRow icon={id} title={busy ? 'Checking…' : `Connect ${name}`} source={name} subtitle="checks the token, then shows how it will appear" action="Connect" hint="↵" selected disabled={busy || !token.trim()} onClick={() => void connect()} /></div>
  </div>
}

const recipeRows = (d: ConnectorDefinition) => d.recipes.filter(r => r.shape === 'collection' || !d.recipes.some(c => c.itemRecipe === r.id)).concat(d.recipes.filter(r => r.shape === 'item' && d.recipes.some(c => c.itemRecipe === r.id)))
  .map(r => ({ resource: r.label, tile: { list: 'List', table: 'Table', timeline: 'Timeline', record: 'Record', document: 'Document', conversation: 'Conversation', diff: 'Diff document' }[r.view] + (r.shape === 'collection' && r.itemRecipe ? ` of ${d.recipes.find(c => c.id === r.itemRecipe)?.label.toLowerCase() || 'items'}` : ''), kind: 'generated' as const, actions: [...(r.actions || []).map(a => { const op = d.operations.find(o => o.id === a.operation); return op?.effect === 'write' ? `${a.label} (asks)` : a.label }), ...(r.searchOperation ? ['Search'] : [])].join(' · ') || (r.shape === 'collection' ? 'Browse' : 'Read') }))

/** Any other service: K reads its API (from what it knows, or docs you link) and proposes a connector. */
export function ConnectorSetup({ name, model, connectors, changed, open, adjust, setupModel, done, enter }: { name: string; model?: ModelInfo; connectors: ConnectorInfo[]; changed: (list: ConnectorInfo[]) => void; open: (input: TileInput) => void; adjust: (definition: ConnectorDefinition) => void; setupModel: () => void; done: () => void; enter?: EnterRef }) {
  const [turns, setTurns] = useState<DiscoveryTurn[]>([{ role: 'user', text: `add ${name}` }])
  const [result, setResult] = useState<DiscoveryResult>()
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  const [token, setToken] = useState('')
  const [kept, setKept] = useState<string>()
  const asked = useRef('')
  const ask = async (next: DiscoveryTurn[]) => {
    setBusy(true); setError(''); setResult(undefined)
    try { const plan = await api.discoverSource(next); setResult(plan); setTurns([...next, { role: 'k', text: plan.kind === 'connector' ? `${plan.text}\n(proposed connector ${plan.definition.id})` : plan.text }]) }
    catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  useEffect(() => { if (model?.ready && asked.current !== name) { asked.current = name; void ask(turns) } }, [model?.ready, name]) // eslint-disable-line react-hooks/exhaustive-deps
  const keptInfo = connectors.find(c => c.definition.id === kept)
  const definition = result?.kind === 'connector' ? result.definition : undefined
  const existing = definition && connectors.find(c => c.definition.id === definition.id)
  const keep = async () => {
    if (!definition || busy) return
    setBusy(true); setError('')
    try { const list = await api.saveConnector(definition, existing?.revision || 0); changed(list); setKept(definition.id); setStatus('Mapping kept. Connect a token, then open a collection to check it.') }
    catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  const send = () => { const text = reply.trim(); if (!text || busy) return; setReply(''); void ask([...turns, { role: 'user', text }]) }
  const collections = useMemo(() => keptInfo ? keptInfo.definition.recipes.filter(r => r.shape === 'collection' && !keptInfo.definition.operations.find(op => op.id === r.operation)?.path.includes('{parent}')) : [], [keptInfo])
  if (!model?.ready) {
    if (enter) enter.current = setupModel
    return <div className="k-panel"><KReply tone="warn">I build connectors with your AI model, and none is connected yet.</KReply><div className="k-rows"><KRow icon="ai" title="Connect a model" source="Model" subtitle="any OpenAI-compatible endpoint, or a local model" action="Set up" hint="↵" selected onClick={setupModel} /></div></div>
  }
  if (enter) enter.current = reply.trim() ? send : definition && !kept ? () => void keep() : kept ? done : undefined
  return <div className="k-panel" data-connector-setup>
    {busy && !definition && <KReply tone="busy">{turns.length > 1 ? 'Thinking…' : `Looking up ${name}’s API…`}</KReply>}
    {result && <KReply tone={result.kind === 'connector' ? 'ok' : 'warn'}>{result.text}</KReply>}
    {!!result?.read.length && <p className="k-note">Read: {result.read.join(', ')}</p>}
    {definition && <>
      <KMap rows={recipeRows(definition)} />
      <p className="k-note">API destination {definition.baseURL} · {definition.auth.type === 'bearer' ? 'token' : definition.auth.type}{definition.auth.help ? ` · ${definition.auth.help}` : ''}. Reads run straight away; writes always ask first.</p>
      {!kept && <div className="button-row k-buttons"><button className="pill primary" disabled={busy} onClick={() => void keep()}>Keep<kbd>↵</kbd></button><button className="pill" onClick={() => adjust(definition)}>Adjust</button><span className="muted">Keep asks for approval of the destination and any write actions.</span></div>}
    </>}
    {keptInfo && <div className="k-fields">
      {keptInfo.definition.auth.type === 'bearer' && <form onSubmit={e => { e.preventDefault(); if (!token.trim()) return; setBusy(true); void api.connectorToken(keptInfo.definition.id, token).then(list => { changed(list); setToken(''); setStatus('Token connected. Open a collection to check the mapping.') }).catch(e => setError(friendlyError(e))).finally(() => setBusy(false)) }}>
        <label className="k-field"><span>API token</span><span className="k-input"><input aria-label="Connector token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder={keptInfo.hasToken ? 'Saved · paste to replace' : 'Paste a token'} /><em className="good">{keptInfo.hasToken ? '✓ saved' : ''}</em></span></label>
      </form>}
      {keptInfo.definition.auth.type === 'oauth2' && <p className="k-note">Sign in from Super+, → Sources → {keptInfo.definition.name}.</p>}
      <div className="button-row k-buttons">{collections.map(r => <button className="pill" key={r.id} onClick={() => { open(recipeTile({ connectorID: keptInfo.definition.id, recipeID: r.id }, r.label, r, keptInfo.definition.name)); done() }}>Open {r.label}</button>)}<button className="pill primary" onClick={done}>Done</button></div>
    </div>}
    {status && <p className="k-note" role="status">{status}</p>}
    {error && <p className="k-error" role="alert">{error}</p>}
    {!kept && <form className="k-followup" onSubmit={e => { e.preventDefault(); send() }}><input aria-label="Reply to K" placeholder={definition ? 'Ask for changes, e.g. “also show projects”' : 'Reply, or paste a link to the API documentation…'} value={reply} disabled={busy} onChange={e => setReply(e.target.value)} /><button className="pill" disabled={busy || !reply.trim()} type="submit">Send</button></form>}
  </div>
}
