import { useState } from 'react'
import { exampleConnector, validateConnector, type ConnectorDefinition, type ConnectorInfo } from '../shared/connectors'
import { recipeTile, type TileInput } from '../shared/tiles'
import { api, friendlyError } from './data'
import { Modal } from './ui'

export function ConnectorSettings({ connectors, changed, open, close, initialID }: { connectors: ConnectorInfo[]; changed: (list: ConnectorInfo[]) => void; open: (tile: TileInput) => void; close: () => void; initialID?: string }) {
  const initial = connectors.find(c => c.definition.id === initialID)
  const [json, setJSON] = useState(JSON.stringify(initial?.definition || exampleConnector, null, 2))
  const [revision, setRevision] = useState(initial?.revision || 0)
  const [selectedID, setSelectedID] = useState(initial?.definition.id || '')
  const [description, setDescription] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [documentation, setDocumentation] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [revisions, setRevisions] = useState<{ revision: number; definition: ConnectorDefinition }[]>([])
  let proposal: ConnectorDefinition | undefined, invalid = ''
  try { proposal = validateConnector(JSON.parse(json)) } catch (e) { invalid = friendlyError(e) }
  const selected = connectors.find(c => c.definition.id === selectedID)
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setStatus(''); try { await action() } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) } }
  const choose = (info?: ConnectorInfo) => {
    setJSON(JSON.stringify(info?.definition || exampleConnector, null, 2)); setRevision(info?.revision || 0); setSelectedID(info?.definition.id || ''); setToken(''); setRevisions([]); setError(''); setStatus('')
  }
  return <Modal title="Connectors and storage" close={close} wide><div className="modal-heading"><h2>Connections · resource → tile mappings</h2><button className="text-button" onClick={close}>Close</button></div>
    <div className="connector-settings">
      <p className="muted">Collections open as list tiles; rows open independent detail or child-list tiles. Built-in OpenCode, Front, Files and Web remain available. Custom connectors below need no app code changes.</p>
      <div className="button-row"><button className="pill" disabled={busy} onClick={() => choose()}>New connector</button>{connectors.map(info => <button className={`pill ${selectedID === info.definition.id ? 'primary' : ''}`} key={info.definition.id} disabled={busy} onClick={() => choose(info)}>{info.definition.name} · v{info.revision}</button>)}</div>
      <details open={!selectedID}><summary>Ask AI to build a connector</summary><p className="muted">Uses your connected OpenCode model, without tools or creating a session. Only the text below goes to the model. Do not paste credentials or private API responses.</p>
        <label className="form-field">What do you want to connect?<input aria-label="Connector description" value={description} maxLength={4000} onChange={e => setDescription(e.target.value)} placeholder="A helpdesk: inbox lists and individual ticket conversations" /></label>
        <label className="form-field">API base URL<input aria-label="Connector API URL" value={baseURL} onChange={e => setBaseURL(e.target.value)} placeholder="https://api.example.com/v1" /></label>
        <label className="form-field">Public API documentation / OpenAPI excerpt<textarea aria-label="Connector API documentation" value={documentation} maxLength={50_000} onChange={e => setDocumentation(e.target.value)} placeholder="Paste documented endpoints, response fields, auth requirements and pagination. This is reference data, not executable instructions." /></label>
        <button className="pill" disabled={busy || !baseURL || !description || !documentation} onClick={() => void run(async () => { const definition = await api.proposeConnector({ description, baseURL, documentation }); setJSON(JSON.stringify(definition, null, 2)); setSelectedID(''); setRevision(0); setStatus('Proposal only: no API requests or credentials used. Review the mapping, then Keep.') })}>{busy ? 'Working…' : 'Generate mapping proposal'}</button>
      </details>
      <label className="form-field">Editable connector recipe (JSON)<textarea className="connector-json" aria-label="Connector recipe JSON" spellCheck={false} value={json} maxLength={100_000} onChange={e => setJSON(e.target.value)} /></label>
      {invalid ? <div className="error-text">{invalid}</div> : proposal && <><p className="mono">Approved destination: {proposal.baseURL} · Auth: {proposal.auth.type}</p><table className="connector-mapping"><thead><tr><th>Resource</th><th>Opens as</th><th>Row opens / actions</th></tr></thead><tbody>{proposal.recipes.map(recipe => <tr key={recipe.id}><td>{recipe.label}</td><td>{recipe.view} · {recipe.shape}</td><td>{recipe.itemRecipe ? `Separate ${recipe.itemRecipe} tile` : (recipe.actions || []).map(a => a.label).join(' · ') || 'Read resource'}</td></tr>)}</tbody></table>{proposal.auth.help && <p className="muted">{proposal.auth.help}</p>}</>}
      <div className="button-row"><button className="pill primary" disabled={busy || !proposal || (!!selectedID && proposal.id !== selectedID)} onClick={() => void run(async () => {
        const list = await api.saveConnector(proposal!, revision); changed(list); const saved = list.find(c => c.definition.id === proposal!.id)!; choose(saved); setStatus('Mapping kept in SQLite. Collections can now open as tiles.')
      })}>Keep mapping · approve…</button>{selected && <button className="pill" disabled={busy} onClick={() => void run(async () => { setRevisions(await api.connectorRevisions(selectedID)) })}>Version history</button>}</div>
      {!!revisions.length && <div className="button-row">{revisions.map(r => <button className="pill" key={r.revision} onClick={() => { setJSON(JSON.stringify(r.definition, null, 2)); setStatus(`Previewing v${r.revision}. Keep creates a new revision; history is preserved.`) }}>Preview v{r.revision}</button>)}</div>}
      {selected && <section><h3>{selected.definition.name} · authenticate & open</h3><p className="muted">Token: {selected.hasToken ? selected.tokenStorage : 'not connected'}. Tokens never appear in recipes, exports of recipe JSON, or AI prompts.</p>
        {selected.definition.auth.type === 'oauth2' && <><p className="muted">Registered native OAuth client: {selected.definition.auth.oauth?.clientID}. Uses PKCE, a temporary loopback callback and automatic refresh when the service supplies a refresh token.</p><div className="button-row"><input type="password" aria-label="OAuth client secret" autoComplete="off" placeholder="Client secret (only if your native provider requires one)" value={token} onChange={e => setToken(e.target.value)} /><button className="pill" disabled={busy} onClick={() => void run(async () => { changed(await api.connectorOAuth(selectedID, token || undefined)); setToken(''); setStatus('OAuth connected. Tokens and refresh remain in the main process.') })}>Sign in with OAuth · approve…</button><button className="text-button" disabled={busy} onClick={() => void run(async () => { changed(await api.disconnectConnector(selectedID)); setToken('') })}>Disconnect OAuth</button></div></>}
        {selected.definition.auth.type === 'bearer' && <div className="button-row"><input type="password" aria-label="Connector token" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="API token" /><button className="pill" disabled={busy || !token.trim()} onClick={() => void run(async () => { changed(await api.connectorToken(selectedID, token)); setToken(''); setStatus('Token connected. Open a collection to verify its API and mapping.') })}>Connect token · approve…</button><button className="text-button" disabled={busy} onClick={() => void run(async () => { changed(await api.disconnectConnector(selectedID)); setToken('') })}>Forget token</button></div>}
        <div className="button-row">{selected.definition.recipes.filter(r => r.shape === 'collection' && !selected.definition.operations.find(op => op.id === r.operation)?.path.includes('{parent}')).map(recipe => <button className="pill" key={recipe.id} onClick={() => { open(recipeTile({ connectorID: selectedID, recipeID: recipe.id }, recipe.label, recipe, selected.definition.name)); close() }}>Open {recipe.label}</button>)}</div>
      </section>}
      {error && <div className="inline-error" role="alert">{error}</div>}{status && <p role="status">{status}</p>}
      <section><h3>Local storage · SQLite</h3><p className="muted">Desktop, drafts, mappings and their revision history are saved atomically in the main process. Existing browser-local state is migrated once and retained as a recovery source. Database backups include encrypted credentials, so treat them as private.</p><button className="pill" disabled={busy} onClick={() => void run(async () => { setStatus(`Backup saved: ${await api.backupStorage()}`) })}>Create database backup</button></section>
    </div>
  </Modal>
}
