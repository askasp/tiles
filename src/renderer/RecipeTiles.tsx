import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { browserTile, recipeTile, type Tile, type TileInput } from '../shared/tiles'
import type { ConnectorInfo, RecipePage } from '../shared/connectors'
import { api, friendlyError } from './data'

export function RecipeBody({ tile, connectors, visible, open, change, settings }: {
  tile: Tile; connectors: ConnectorInfo[]; visible: boolean; open: (tile: TileInput) => void;
  change: (patch: Partial<Tile>) => void; settings: () => void;
}) {
  const info = connectors.find(c => c.definition.id === tile.resource?.connectorID)
  const recipe = info?.definition.recipes.find(r => r.id === tile.resource?.recipeID)
  const [page, setPage] = useState<RecipePage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(tile.resource?.query || '')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState({ column: -1, ascending: true })
  const [selectedRow, setSelectedRow] = useState(0)
  const generation = useRef(0)
  const actionLock = useRef(false)
  const currentDraft = useRef(tile.draft); currentDraft.current = tile.draft
  const load = async (cursor?: string) => {
    const version = ++generation.current
    setBusy(true); setError('')
    try {
      const next = await api.readRecipe(tile.resource!, cursor)
      if (generation.current === version) setPage(previous => cursor && previous ? { ...next, items: [...previous.items, ...next.items.filter(item => !previous.items.some(old => old.id === item.id))], messages: [...previous.messages, ...next.messages] } : next)
    } catch (e) { if (generation.current === version) setError(friendlyError(e)) }
    finally { if (generation.current === version) setBusy(false) }
  }
  useEffect(() => {
    if (visible && recipe) void load()
    return () => { generation.current++ }
  }, [visible, info?.revision, info?.hasToken, tile.resource?.recipeID, tile.resource?.query, tile.resource?.parentID, tile.resource?.resourceID])
  const action = async (operation: string) => {
    if (actionLock.current) return
    actionLock.current = true; setBusy(true); setError(''); setStatus('')
    const draft = currentDraft.current
    try {
      await api.recipeAction(tile.resource!, operation, draft)
      const actionOperation = info?.definition.operations.find(op => op.id === operation)
      const consumesDraft = [...Object.values(actionOperation?.body || {}), ...Object.values(actionOperation?.query || {})].some(value => value.includes('{draft}'))
      if (actionOperation?.effect === 'write' && consumesDraft && currentDraft.current === draft) change({ draft: '' })
      setStatus('Action completed.'); await load()
    } catch (e) { setError(friendlyError(e)) }
    finally { actionLock.current = false; setBusy(false) }
  }
  if (!recipe) return <div className="recipe-body"><p>This connector or recipe is unavailable. Your tile and draft are kept.</p><button className="pill" onClick={settings}>Manage connectors</button></div>
  const openItem = (item: { id: string; title: string; parentID?: string }) => {
    const child = info!.definition.recipes.find(r => r.id === recipe.itemRecipe)!
    try {
      open(recipeTile({ connectorID: tile.resource!.connectorID, recipeID: child.id, ...(child.shape === 'collection' ? { parentID: item.id } : { resourceID: item.id, ...((item.parentID || tile.resource!.parentID) && { parentID: item.parentID || tile.resource!.parentID }) }) }, item.title, child, info!.definition.name))
    } catch (e) { setError(friendlyError(e)) }
  }
  const sortedItems = [...(page?.items || [])].sort((a, b) => {
    if (recipe.view === 'timeline') {
      const timestamp = (s?: string) => !s ? Infinity : /^\d+$/.test(s) ? Number(s) : Number.isNaN(Date.parse(s)) ? Infinity : Date.parse(s)
      return timestamp(a.time) - timestamp(b.time)
    }
    if (recipe.view !== 'table') return 0
    const first = sort.column < 0 ? a.title : a.fields[sort.column]?.value || '', second = sort.column < 0 ? b.title : b.fields[sort.column]?.value || ''
    const numeric = sort.column >= 0 && recipe.fields?.[sort.column]?.kind === 'number' && Number.isFinite(Number(first)) && Number.isFinite(Number(second))
    return (numeric ? Number(first) - Number(second) : first.localeCompare(second, undefined, { numeric: true })) * (sort.ascending ? 1 : -1)
  })
  const sortBy = (column: number) => setSort(previous => ({ column, ascending: previous.column === column ? !previous.ascending : true }))
  return <div className="recipe-body" tabIndex={0} onKeyDown={e => {
    if (recipe.shape !== 'collection' || (e.target as HTMLElement).matches('input, textarea, button') || e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelectedRow(i => Math.max(0, Math.min(sortedItems.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
    if (e.key === 'Enter' && sortedItems[selectedRow]) { e.preventDefault(); openItem(sortedItems[selectedRow]) }
  }}>
    <div className="recipe-toolbar"><span>{info?.definition.name} · {recipe.view} · recipe v{info?.revision}</span><button className="pill" disabled={busy} onClick={() => void load()}>Refresh</button><button className="text-button" onClick={settings}>Mapping</button></div>
    {recipe.shape === 'collection' && <form className="recipe-filter" onSubmit={e => { e.preventDefault(); open(recipeTile({ ...tile.resource!, query: query.trim() }, `${recipe.label}${query.trim() ? ` · ${query.trim()}` : ''}`, recipe, info?.definition.name)) }}><input aria-label="Collection filter" placeholder="API search / filter…" value={query} maxLength={300} onChange={e => setQuery(e.target.value)} /><button className="pill" type="submit">Open filtered list</button></form>}
    {error && <div className="inline-error" role="alert">{error}<button className="text-button" onClick={settings}>Connections</button></div>}
    {status && <div role="status">{status}</div>}
    <div className="recipe-content">
      {recipe.view === 'table' ? <table className="recipe-table"><thead><tr><th><button onClick={() => sortBy(-1)}>Title ↕</button></th>{recipe.fields?.map((field, i) => <th key={i}><button onClick={() => sortBy(i)}>{field.label} ↕</button></th>)}</tr></thead><tbody>{sortedItems.map((item, row) => <tr className={selectedRow === row ? 'selected' : ''} key={item.id}><td><button className="text-button" onClick={() => openItem(item)}>{item.title}</button></td>{item.fields.map((f, i) => <td key={i}>{f.value}</td>)}</tr>)}</tbody></table> : sortedItems.map((item, row) => recipe.shape === 'collection' ? <button className={`recipe-list-row ${selectedRow === row ? 'selected' : ''} ${recipe.view === 'timeline' ? 'recipe-timeline-row' : ''}`} key={item.id} onMouseEnter={() => setSelectedRow(row)} onClick={() => openItem(item)}>{recipe.view === 'timeline' && <time>{item.time || 'Undated'}</time>}<strong>{item.title}</strong><small>{item.subtitle}</small></button> : <article key={item.id}>
        <h2>{item.title}</h2>{item.subtitle && <p className="muted">{item.subtitle}</p>}
        {!!item.fields.length && <dl className="recipe-fields">{item.fields.map((field, i) => <div key={i}><dt>{field.label}</dt><dd className={field.kind === 'badge' ? 'recipe-badge' : ''}>{field.value}</dd></div>)}</dl>}
        {item.text && (recipe.view === 'diff' ? <pre className="recipe-diff">{item.text}</pre> : recipe.view === 'document' ? <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>{alt || 'Image omitted'}</span>, a: ({ href, children }) => <a href={href && /^https?:\/\//.test(href) ? href : undefined} onClick={e => { e.preventDefault(); if (href && /^https?:\/\//.test(href)) { try { open(browserTile(href)) } catch (error) { setError(friendlyError(error)) } } }}>{children}</a> }}>{item.text}</ReactMarkdown></div> : <div className="recipe-text">{item.text}</div>)}
      </article>)}
      {page?.messages.map((message, i) => <div className={`recipe-message recipe-message-${message.kind}`} key={i}><header><strong>{message.kind === 'note' ? 'Internal note' : message.kind === 'tool-call' ? 'Tool call' : message.kind === 'event' ? 'Event' : 'Message'}</strong>{message.author && <span>{message.author}</span>}{message.time && <time>{message.time}</time>}</header>{message.text}</div>)}
      {!busy && page && !page.items.length && <p className="muted">No matching resources.</p>}
      {busy && <p className="muted">Loading…</p>}
      {page?.next && <button className="pill" disabled={busy || (page.items.length + page.messages.length) >= 1000} onClick={() => void load(page.next)}>Load more</button>}
    </div>
    {!!recipe.actions?.length && <div className="recipe-actions"><textarea aria-label="Resource action draft" placeholder="Action draft (saved locally)…" value={tile.draft} maxLength={60_000} onChange={e => change({ draft: e.target.value })} /><div className="button-row">{recipe.actions.map(a => <button key={a.operation} className="pill" disabled={busy} onClick={() => void action(a.operation)}>{a.label}{info?.definition.operations.find(op => op.id === a.operation)?.effect === 'write' ? ' · confirm…' : ''}</button>)}</div><small className="muted">Writes always require a separate confirmation. Layout undo does not undo service actions.</small></div>}
  </div>
}
