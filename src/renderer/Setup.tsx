import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
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
export function KRow({ icon, title, source, subtitle, action, hint, selected, disabled, onClick, label }: { icon: string; title: string; source: string; subtitle?: string; action: string; hint?: string; selected?: boolean; disabled?: boolean; onClick: (event: React.MouseEvent) => void; label?: string }) {
  return <button type="button" aria-label={label || title} className={`launcher-result k-row ${selected ? 'selected' : ''}`} disabled={disabled} onClick={e => onClick(e)}>
    <span className={`k-icon k-icon-${icon}`}>{iconText[icon] || icon.slice(0, 2)}</span>
    <span className="launcher-result-copy"><strong className="truncate">{title}</strong><span className="k-meta"><span className="k-source">{source}</span>{subtitle && <small className="truncate">{subtitle}</small>}</span></span>
    <span className="k-action">{action}</span><kbd className="k-key">{hint || ''}</kbd>
  </button>
}
/** Badge text. Sources pick a badge id; unknown ids show their first two letters. */
export const iconText: Record<string, string> = { ai: 'ai', web: '↗', files: '/', file: '·', terminal: '>_', front: 'fr', slack: 'sl', github: 'gh', search: '?', connector: '◇', add: '+', tile: '▢' }
/** Sources register their own badge text, e.g. OpenCode's “oc”. */
export const registerBadge = (id: string, text: string) => { iconText[id] = text }

const nonChat = /embed|whisper|tts|dall-e|moderation|audio|image|transcri|realtime|search|rerank|vision-preview/i
export function preferredModel(models: string[], current?: string) {
  if (current && models.includes(current)) return current
  return models.find(m => !nonChat.test(m)) || models[0] || ''
}

/** A0: the one thing first launch asks for. Any OpenAI-compatible endpoint, or a local model. */
export function ModelSetup({ info, firstRun, saved, skip, enter, embedded }: { info?: ModelInfo; firstRun: boolean; saved: (info: ModelInfo) => void; skip?: () => void; enter?: EnterRef; embedded?: boolean }) {
  const [baseURL, setBaseURL] = useState(info?.configured ? info.baseURL : 'https://api.openai.com/v1')
  const [apiKey, setAPIKey] = useState('')
  const [model, setModel] = useState(info?.model || '')
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
      : <div className="button-row k-buttons"><button className="pill primary" disabled={!canConnect} onClick={() => void connect()}>{busy ? 'Connecting…' : info?.ready ? 'Save model' : 'Connect model'}</button>{!local && <button className="pill" onClick={useLocal}>Use a local model</button>}{info?.tokenStorage !== 'none' && info?.ready && <button className="text-button" onClick={() => void api.forgetModelKey().then(saved).catch(e => setError(friendlyError(e)))}>Forget key</button>}</div>}
    {!embedded && <ModelRowKeys count={rows.length} move={d => setChoice(c => Math.max(0, Math.min(rows.length - 1, c + d)))} />}
  </div>
}
/** ↑/↓ choose a row in a setup panel while focus stays in the K input. */
export function ModelRowKeys({ count, move }: { count: number; move: (delta: number) => void }) {
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

const recipeRows = (d: ConnectorDefinition, kind: 'built-in' | 'generated' = 'generated') => d.recipes.filter(r => r.shape === 'collection' || !d.recipes.some(c => c.itemRecipe === r.id)).concat(d.recipes.filter(r => r.shape === 'item' && d.recipes.some(c => c.itemRecipe === r.id)))
  .map(r => ({ resource: r.label, tile: { list: 'List', table: 'Table', timeline: 'Timeline', record: 'Record', document: 'Document', conversation: 'Conversation', diff: 'Diff document' }[r.view] + (r.shape === 'collection' ? ` of ${r.label.toLowerCase()}` : '') + (r.urlField && !r.itemRecipe ? ' · open as web pages' : ''), kind, actions: [...(r.actions || []).map(a => { const op = d.operations.find(o => o.id === a.operation); return op?.effect === 'write' ? `${a.label} (asks)` : a.label }), ...(r.searchOperation ? ['Search'] : [])].join(' · ') || (r.shape === 'collection' ? 'Browse' : 'Read') }))

/** Any other service: K reads its API (from what it knows, or docs you link) and proposes a connector. */
export function ConnectorSetup({ name, model, connectors, changed, open, adjust, setupModel, done, enter }: { name: string; model?: ModelInfo; connectors: ConnectorInfo[]; changed: (list: ConnectorInfo[]) => void; open: (input: TileInput) => void; adjust: (definition: ConnectorDefinition) => void; setupModel: () => void; done: () => void; enter?: EnterRef }) {
  const [turns, setTurns] = useState<DiscoveryTurn[]>([{ role: 'user', text: `add ${name}` }])
  const [result, setResult] = useState<DiscoveryResult>()
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
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
      <p className="k-note">API destination {definition.baseURL} · {({ bearer: 'token', none: 'no sign-in needed', 'oauth-required': 'needs an OAuth app', oauth2: 'OAuth sign-in' } as Record<string, string>)[definition.auth.type]}{definition.auth.help ? ` · ${definition.auth.help}` : ''}. Reads run straight away; writes always ask first.</p>
      {!kept && <div className="button-row k-buttons"><button className="pill primary" disabled={busy} onClick={() => void keep()}>Keep<kbd>↵</kbd></button><button className="pill" onClick={() => adjust(definition)}>Adjust</button><span className="muted">Keep asks for approval of the destination and any write actions.</span></div>}
    </>}
    {keptInfo && <KeptConnector info={keptInfo} changed={changed} open={open} done={done} status={setStatus} error={setError} />}
    {status && <p className="k-note" role="status">{status}</p>}
    {error && <p className="k-error" role="alert">{error}</p>}
    {!kept && <form className="k-followup" onSubmit={e => { e.preventDefault(); send() }}><input aria-label="Reply to K" placeholder={definition ? 'Ask for changes, e.g. “also show projects”' : 'Reply, or paste a link to the API documentation…'} value={reply} disabled={busy} onChange={e => setReply(e.target.value)} /><button className="pill" disabled={busy || !reply.trim()} type="submit">Send</button></form>}
  </div>
}

/** After a connector is kept: its token, then open a collection to check it. */
function KeptConnector({ info, changed, open, done, status, error }: { info: ConnectorInfo; changed: (list: ConnectorInfo[]) => void; open: (input: TileInput) => void; done: () => void; status: (text: string) => void; error: (text: string) => void }) {
  const [token, setToken] = useState(''), [busy, setBusy] = useState(false)
  const collections = useMemo(() => info.definition.recipes.filter(r => r.shape === 'collection' && !info.definition.operations.find(op => op.id === r.operation)?.path.includes('{parent}')), [info])
  const connect = () => {
    if (!token.trim() || busy) return
    setBusy(true); error('')
    void api.connectorToken(info.definition.id, token).then(list => {
      changed(list); setToken('')
      const account = list.find(c => c.definition.id === info.definition.id)?.account
      status(account ? `Connected as ${account}. Open a list to check it.` : 'Token connected. Open a collection to check the mapping.')
    }).catch(e => error(friendlyError(e))).finally(() => setBusy(false))
  }
  return <div className="k-fields">
    {info.definition.auth.type === 'bearer' && <form onSubmit={e => { e.preventDefault(); connect() }}>
      <label className="k-field"><span>API token</span><span className="k-input"><input aria-label="Connector token" type="password" autoComplete="off" spellCheck={false} autoFocus={!info.hasToken} value={token} onChange={e => setToken(e.target.value)} placeholder={info.hasToken ? 'Saved · paste to replace' : 'Paste a token'} /><em className="good">{busy ? 'checking…' : info.hasToken ? `✓ ${info.account || 'saved'}` : ''}</em></span></label>
    </form>}
    {info.definition.auth.type === 'oauth2' && <p className="k-note">Sign in from Super+, → Sources → {info.definition.name}.</p>}
    <div className="button-row k-buttons">{collections.map(r => <button className="pill" key={r.id} onClick={() => { open(recipeTile({ connectorID: info.definition.id, recipeID: r.id }, `${info.definition.name} · ${r.label}`, r, info.definition.name)); done() }}>Open {r.label}</button>)}<button className="pill primary" onClick={done}>Done</button></div>
  </div>
}

/** Front, Slack, GitHub: they ship with ChatOS, so nothing is generated and no model is needed. */
export function BuiltinSetup({ id, connectors, changed, open, done, enter }: { id: string; connectors: ConnectorInfo[]; changed: (list: ConnectorInfo[]) => void; open: (input: TileInput) => void; done: () => void; enter?: EnterRef }) {
  const [builtin, setBuiltin] = useState<{ definition: ConnectorDefinition; hint: string; settings: { key: string; label: string }[] }>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('')
  useEffect(() => { void api.builtinConnector(id).then(setBuiltin).catch(e => setError(friendlyError(e))) }, [id])
  const info = connectors.find(c => c.definition.id === id)
  const keep = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { changed(await api.addBuiltinConnector(id)); setStatus(builtin?.definition.auth.type === 'bearer' ? 'Added. Paste an API token to connect it.' : 'Added.') }
    catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  if (!builtin) return <div className="k-panel">{error ? <p className="k-error" role="alert">{error}</p> : <KReply tone="busy">Loading…</KReply>}</div>
  const d = builtin.definition
  if (enter) enter.current = info ? done : () => void keep()
  return <div className="k-panel" data-connector-setup={id}>
    <KReply>{info ? `${d.name} is added${info.hasToken ? `, connected as ${info.account || 'your token'}` : ''}.` : `${d.name} ships with ChatOS: ${builtin.hint.toLowerCase()}. This is how it shows up:`}</KReply>
    <KMap rows={recipeRows(d, 'built-in')} />
    <p className="k-note">API destination {d.baseURL}{d.auth.help ? ` · ${d.auth.help}` : ''} Reads run straight away; writes always ask first.{builtin.settings.length ? ` Optional in Super+, → Sources: ${builtin.settings.map(s => s.label.toLowerCase()).join(', ')}.` : ''}</p>
    {!info && <div className="button-row k-buttons"><button className="pill primary" disabled={busy} onClick={() => void keep()}>Add {d.name}<kbd>↵</kbd></button></div>}
    {info && <KeptConnector info={info} changed={changed} open={open} done={done} status={setStatus} error={setError} />}
    {status && <p className="k-note" role="status">{status}</p>}
    {error && <p className="k-error" role="alert">{error}</p>}
  </div>
}
