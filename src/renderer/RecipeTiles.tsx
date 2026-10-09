import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { browserTile, recipeTile, type Tile, type TileInput } from '../shared/tiles'
import type { ConnectorInfo, RecipePage } from '../shared/connectors'
import { api, friendlyError } from './data'
import { filterField, systemKey } from './ui'
import { useTileActions } from './actions'
import { listOpen, type ListOpen } from './sources/types'

type RecipeProps = {
  tile: Tile; connectors: ConnectorInfo[]; visible: boolean; open: (tile: TileInput) => void;
  /** Open from this list: ↵ in place (Back returns), Ctrl+↵ beside, Ctrl+Shift+↵ in a new workspace. */
  openFrom: (input: TileInput, how: ListOpen) => void;
  change: (patch: Partial<Tile>) => void; settings: () => void;
}

export function RecipeBody(props: RecipeProps) {
  const { tile, connectors, settings } = props
  const info = connectors.find(c => c.definition.id === tile.resource?.connectorID)
  const recipe = info?.definition.recipes.find(r => r.id === tile.resource?.recipeID)
  if (!recipe) return <div className="recipe-body"><p>This connector or recipe is unavailable. Your tile and draft are kept.</p><span className="muted">{systemKey}+, → Sources manages connectors.</span></div>
  // A list opening a row in place becomes another resource: start it fresh, not with the list's rows.
  return <RecipeView key={tile.key} {...props} />
}

function RecipeView({ tile, connectors, visible, open, openFrom, change, settings }: RecipeProps) {
  const info = connectors.find(c => c.definition.id === tile.resource?.connectorID)
  const recipe = info!.definition.recipes.find(r => r.id === tile.resource?.recipeID)!
  const [page, setPage] = useState<RecipePage>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(tile.resource?.query || '')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState({ column: -1, ascending: true })
  const draftField = useRef<HTMLTextAreaElement>(null)
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
  const openItem = (item: { id: string; title: string; parentID?: string; url?: string }, how: ListOpen = 'replace') => {
    const child = info!.definition.recipes.find(r => r.id === recipe.itemRecipe)
    try {
      // Rows that are web pages (a Slack message, a pull request) open in a Browser tile.
      if (item.url || !child) { if (item.url) openFrom({ ...browserTile(item.url), title: item.title, label: item.title }, how); return }
      openFrom(recipeTile({ connectorID: tile.resource!.connectorID, recipeID: child.id, ...(child.shape === 'collection' ? { parentID: item.id } : { resourceID: item.id, ...((item.parentID || tile.resource!.parentID) && { parentID: item.parentID || tile.resource!.parentID }) }) }, item.title, child, info!.definition.name), how)
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
  const presets = recipe.shape === 'collection' ? info?.filters?.filter(f => f.recipeID === recipe.id) || [] : []
  const operations = recipe.actions || []
  useTileActions(tile.id, 'recipe', [
    { id: 'refresh', label: 'Refresh', key: 'r', disabled: busy, run: () => void load() },
    { id: 'mapping', label: 'Mapping & connection', key: 'e', run: settings },
    ...(page?.next ? [{ id: 'more', label: 'Load more', key: 'm', disabled: busy || (page.items.length + page.messages.length) >= 1000, run: () => void load(page.next) }] : []),
    ...presets.map(f => ({ id: `preset-${f.title}`, label: `Show ${f.title}${(tile.resource?.query || '') === f.query ? ' (shown)' : ''}`, disabled: !f.ready, run: () => open(recipeTile({ connectorID: info!.definition.id, recipeID: recipe.id, ...(f.query && { query: f.query }) }, `${info!.definition.name} · ${f.title}`, recipe, info!.definition.name)) })),
    ...(recipe.view === 'table' ? [{ label: 'Title', i: -1 }, ...(recipe.fields || []).map((field, i) => ({ label: field.label, i }))].map(c => ({ id: `sort-${c.i}`, label: `Sort by ${c.label}${sort.column === c.i ? (sort.ascending ? ' (↑ now)' : ' (↓ now)') : ''}`, run: () => sortBy(c.i) })) : []),
    ...(operations.length ? [{ id: 'draft', label: 'Write the action draft', key: 'i', run: () => draftField.current?.focus() }] : []),
    ...operations.map(a => ({ id: `run-${a.operation}`, label: `${a.label}${info?.definition.operations.find(op => op.id === a.operation)?.effect === 'write' ? ' · asks first' : ''}`, disabled: busy, run: () => void action(a.operation) })),
  ])
  // Rows: ↵ opens in place, Ctrl+↵ beside, Ctrl+Shift+↵ in a new workspace (the click does the same with Ctrl/Shift).
  const row = (item: Parameters<typeof openItem>[0]) => ({ onClick: (e: React.MouseEvent) => openItem(item, listOpen(e)), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openItem(item, listOpen(e)) } } })
  return <div className="recipe-body" tabIndex={0}>
    <div className="recipe-toolbar"><span>{info?.definition.name} · {recipe.view} · recipe v{info?.revision}{presets.length ? ` · ${presets.find(f => (tile.resource?.query || '') === f.query)?.title || 'custom filter'}` : ''}</span><span className="muted"><kbd>␣ t</kbd> refresh, filters, mapping</span></div>
    {recipe.shape === 'collection' && <form className="recipe-filter filter-row" onSubmit={e => { e.preventDefault(); open(recipeTile({ ...tile.resource!, query: query.trim() }, `${recipe.label}${query.trim() ? ` · ${query.trim()}` : ''}`, recipe, info?.definition.name)) }}><input {...filterField} aria-label="Collection filter" placeholder="API search / filter… ↵ opens the list" value={query} maxLength={300} onChange={e => setQuery(e.target.value)} /><kbd aria-hidden>/</kbd></form>}
    {error && <div className="inline-error" role="alert">{error}<span className="muted"><kbd>e</kbd> mapping & connection · <kbd>r</kbd> retry</span></div>}
    {status && <div role="status">{status}</div>}
    <div className="recipe-content">
      {recipe.view === 'table' ? <table className="recipe-table"><thead><tr><th>Title{sort.column === -1 ? (sort.ascending ? ' ↑' : ' ↓') : ''}</th>{recipe.fields?.map((field, i) => <th key={i}>{field.label}{sort.column === i ? (sort.ascending ? ' ↑' : ' ↓') : ''}</th>)}</tr></thead><tbody>{sortedItems.map(item => <tr key={item.id}><td><button className="text-button" {...row(item)}>{item.title}</button></td>{item.fields.map((f, i) => <td key={i}>{f.value}</td>)}</tr>)}</tbody></table> : sortedItems.map(item => recipe.shape === 'collection' ? <button className={`recipe-list-row ${recipe.view === 'timeline' ? 'recipe-timeline-row' : ''}`} key={item.id} {...row(item)}>{recipe.view === 'timeline' && <time>{item.time || 'Undated'}</time>}<strong>{item.title}</strong><small>{item.subtitle}</small></button> : <article key={item.id}>
        <h2>{item.title}</h2>{item.subtitle && <p className="muted">{item.subtitle}</p>}
        {!!item.fields.length && <dl className="recipe-fields">{item.fields.map((field, i) => <div key={i}><dt>{field.label}</dt><dd className={field.kind === 'badge' ? 'recipe-badge' : ''}>{field.value}</dd></div>)}</dl>}
        {item.text && (recipe.view === 'diff' ? <pre className="recipe-diff">{item.text}</pre> : recipe.view === 'document' ? <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>{alt || 'Image omitted'}</span>, a: ({ href, children }) => <a href={href && /^https?:\/\//.test(href) ? href : undefined} onClick={e => { e.preventDefault(); if (href && /^https?:\/\//.test(href)) { try { open(browserTile(href)) } catch (error) { setError(friendlyError(error)) } } }}>{children}</a> }}>{item.text}</ReactMarkdown></div> : <div className="recipe-text">{item.text}</div>)}
      </article>)}
      {page?.messages.map((message, i) => <div className={`recipe-message recipe-message-${message.kind}`} key={i}><header><strong>{message.kind === 'note' ? 'Internal note' : message.kind === 'tool-call' ? 'Tool call' : message.kind === 'event' ? 'Event' : 'Message'}</strong>{message.author && <span>{message.author}</span>}{message.time && <time>{message.time}</time>}</header>{message.text}</div>)}
      {!busy && page && !page.items.length && <p className="muted">No matching resources.</p>}
      {busy && <p className="muted">Loading…</p>}
      {page?.next && <p className="muted"><kbd>m</kbd> loads more</p>}
    </div>
    {!!recipe.actions?.length && <div className="recipe-actions"><textarea ref={draftField} aria-label="Resource action draft" placeholder="Action draft (saved locally)…" value={tile.draft} maxLength={60_000} onChange={e => change({ draft: e.target.value })} /><p className="muted"><kbd>i</kbd> writes the draft · <kbd>␣ t</kbd> runs {recipe.actions.map(a => a.label).join(", ")}</p><small className="muted">Writes always require a separate confirmation. Layout undo does not undo service actions.</small></div>}
  </div>
}
