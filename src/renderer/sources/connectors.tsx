import { useState } from 'react'
import { browserTile, recipeTile } from '../../shared/tiles'
import type { ConnectorInfo } from '../../shared/connectors'
import { api, friendlyError } from '../data'
import { RecipeBody } from '../RecipeTiles'
import { iconText } from '../Setup'
import { source, type Candidate } from './types'

const collections = (c: ConnectorInfo) => c.definition.recipes.filter(r => r.shape === 'collection' && !c.definition.operations.find(op => op.id === r.operation)?.path.includes('{parent}'))
const badge = (c: ConnectorInfo) => iconText[c.definition.id] ? c.definition.id : 'connector'
/** A collection, or one of its saved filters, as a tile. */
const filterTile = (c: ConnectorInfo, recipeID: string, query: string, title: string, prefix = true) => {
  const recipe = c.definition.recipes.find(r => r.id === recipeID)!
  return recipeTile({ connectorID: c.definition.id, recipeID, ...(query && { query }) }, prefix ? `${c.definition.name} · ${title}` : title, recipe, c.definition.name)
}
/**
 * Every connector: the ones that ship with ChatOS (Front, Slack, GitHub) and the ones K builds.
 * Same tiles, setup, tokens, confirmations and search for all of them.
 */
export const connectorsSource = source<{ connectors: ConnectorInfo[] }>({
  id: 'connectors', badge: 'connector', kinds: ['recipe'],
  use: env => ({ connectors: env.connectors }),
  added: state => state.connectors.length > 0,
  scopes: state => state.connectors.map(c => ({ id: `connector:${c.definition.id}`, name: c.definition.name })),
  status: state => state.connectors.map(c => ({ key: c.definition.id, name: c.definition.id, ok: c.hasToken || c.definition.auth.type === 'none', label: `${c.definition.name} source` })),
  candidates: (q, state) => state.connectors.flatMap(c => [
    ...collections(c).map(r => filterTile(c, r.id, '', r.label, false)),
    ...(c.filters || []).filter(f => f.ready && f.query).map(f => filterTile(c, f.recipeID, f.query, f.title)),
  ].map(input => ({ input, score: q.rank(`${input.title} ${c.definition.name}`) }))),
  commands(q, state, env) {
    // Narrowed to a connector (`mail tag:me`, Tab): open its list with that filter. Lists of web
    // pages (Slack, GitHub) show their matches first; lists of tiles (Front mail) the list first.
    const scoped = [q.scope, q.prefix].find(s => s?.startsWith('connector:'))?.slice(10)
    const c = scoped && state.connectors.find(x => x.definition.id === scoped)
    if (!c || !q.text || q.text.length > 300) return []
    return collections(c).filter(r => r.searchOperation).map(r => {
      const input = filterTile(c, r.id, q.text, `${r.label} · ${q.text}`)
      return { key: `filter:${input.key}`, icon: badge(c), title: input.title, source: `${c.definition.name} list`, subtitle: 'the list with this filter · reading changes nothing', action: 'Show list', first: !r.urlField && !c.filters?.some(f => f.title.toLowerCase().includes(q.text.toLowerCase())), run: mode => env.open(input, mode) }
    })
  },
  search(q, state) {
    // Typing `mail …`, `dm …` or Tab-narrowing searches that source; built-ins never search on every keystroke.
    const scoped = [q.scope, q.prefix].find(s => s?.startsWith('connector:'))?.slice(10)
    if (q.text.length < 2 || !state.connectors.length || (q.scope && !q.scope.startsWith('connector:'))) return undefined
    if (!scoped && state.connectors.every(c => c.scopedSearch)) return undefined
    return api.searchConnectors(q.text, scoped).then(result => result.resources.flatMap((resource): Candidate[] => {
      const connector = state.connectors.find(c => c.definition.id === resource.ref.connectorID)
      if (resource.url) { try { return [{ input: { ...browserTile(resource.url), title: resource.title, label: resource.title }, score: 100 }] } catch { return [] } }
      const recipe = connector?.definition.recipes.find(r => r.id === resource.ref.recipeID)
      return connector && recipe ? [{ input: recipeTile(resource.ref, resource.title, recipe, connector.definition.name), score: 100 }] : []
    }))
  },
  Settings: ({ state, env }) => <>{state.connectors.map(c => c.builtin ? <BuiltinRow key={c.definition.id} connector={c} changed={env.setConnectors} />
    : <div className="source-row" key={c.definition.id}><span className="k-icon k-icon-connector md" aria-hidden>◇</span><span><strong>{c.definition.name}</strong><small>{c.definition.baseURL} · v{c.revision} · {c.hasToken ? 'connected' : c.definition.auth.type === 'none' ? 'no auth' : 'needs a token'}</small></span><em>generated</em><button className="text-button" onClick={() => env.editConnector({ id: c.definition.id })}>Mapping & auth</button></div>)}</>,
  Tile: ({ tile, state, env, visible }) => <RecipeBody tile={tile} connectors={state.connectors} visible={visible} open={env.open} change={patch => env.changeTile(tile.id, patch)} settings={() => { const c = state.connectors.find(x => x.definition.id === tile.resource?.connectorID); if (c?.builtin || !c) env.ask(`add ${tile.resource?.connectorID || ''}`); else env.editConnector({ id: c.definition.id }) }} />,
})

/** A built-in connector in Settings: its token, the values it asks for, and Remove. */
function BuiltinRow({ connector: c, changed }: { connector: ConnectorInfo; changed: (list: ConnectorInfo[]) => void }) {
  const [token, setToken] = useState('')
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries((c.settings || []).map(s => [s.key, s.value])))
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<ConnectorInfo[]>, done: string) => {
    setBusy(true); setStatus('')
    try { changed(await action()); setStatus(done) } catch (e) { setStatus(friendlyError(e)) } finally { setBusy(false) }
  }
  const name = c.definition.name
  return <details className="source-row-details">
    <summary className="source-row"><span className={`k-icon k-icon-${badge(c)} md`} aria-hidden>{iconText[badge(c)]}</span><span><strong>{name}</strong><small>{c.hasToken ? `${c.account || 'token saved'} · ${c.tokenStorage === 'encrypted' ? 'keyring' : 'this run only'}` : 'no API token'}</small></span><em>built in</em></summary>
    <form className="k-fields" onSubmit={e => { e.preventDefault(); if (token.trim()) void run(() => api.connectorToken(c.definition.id, token), 'Token checked and saved.').then(() => setToken('')) }}>
      <label className="k-field"><span>API token</span><span className="k-input"><input aria-label={`${name} API token`} type="password" autoComplete="off" spellCheck={false} value={token} placeholder={c.hasToken ? 'Saved · paste a new token to replace it' : 'Paste a token'} onChange={e => setToken(e.target.value)} /></span></label>
      {c.definition.auth.help && <p className="k-note">{c.definition.auth.help}</p>}
    </form>
    {!!c.settings?.length && <form className="k-fields" onSubmit={e => { e.preventDefault(); void run(() => api.connectorSettings(c.definition.id, values), 'Saved. Filters that use these are ready in Super+K.') }}>
      {c.settings.map(s => <label className="k-field" key={s.key}><span>{s.label}</span><span className="k-input"><input aria-label={`${name} ${s.label}`} value={values[s.key] || ''} placeholder={s.placeholder} spellCheck={false} onChange={e => setValues(v => ({ ...v, [s.key]: e.target.value }))} /></span></label>)}
      <div className="button-row"><button className="pill" disabled={busy} type="submit">Save</button></div>
    </form>}
    <div className="button-row">
      {c.hasToken && <button className="text-button" disabled={busy} onClick={() => void run(() => api.disconnectConnector(c.definition.id), 'Token removed.')}>Forget token</button>}
      <button className="text-button" disabled={busy} onClick={() => void run(() => api.removeConnector(c.definition.id), `${name} removed. Browser sign-ins are unchanged.`)}>Remove {name} as a source</button>
    </div>
    {status && <p className="k-note" role="status">{status}</p>}
  </details>
}
