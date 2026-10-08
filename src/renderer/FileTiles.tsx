import { ArrowLeft, ArrowRight, ArrowUp, FileImage, FileText, FolderOpen, GitCompare, MessageSquare, Plus, RefreshCw, SquareTerminal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderPage, TextFile } from '../shared/types'
import { fileTile, type OpenMode, type Tile, type TileInput } from '../shared/tiles'
import { api, friendlyError } from './data'
import { KeyButton, filterField } from './ui'
import type { Other } from './sources/types'

const imageExtension = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i
const icons = { terminal: SquareTerminal, sessions: MessageSquare, new: Plus, folder: FolderOpen, review: GitCompare }
/** Where each Files tile has been, for Back/Forward. Lives as long as the window. */
const trail = new Map<string, { back: string[]; forward: string[] }>()
const historyOf = (id: string) => { let h = trail.get(id); if (!h) { h = { back: [], forward: [] }; trail.set(id, h) } return h }

/** Folder or file. Enter goes into it in this tile; Ctrl+Enter opens it beside. Back/Forward walk this tile's history. */
export function FileBody({ tile, open, replace, actions }: { tile: Tile; open: (input: TileInput, mode?: OpenMode) => void; replace: (input: TileInput) => void; actions: Other[] }) {
  const [folder, setFolder] = useState<FolderPage>()
  const [file, setFile] = useState<TextFile>()
  const [image, setImage] = useState<{ dataURL: string; size: number }>()
  const [filter, setFilter] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(0)
  const [, setVersion] = useState(0)
  const generation = useRef(0), rows = useRef<HTMLDivElement>(null)
  const history = historyOf(tile.id)
  const refresh = useCallback(async () => {
    const revision = ++generation.current; setBusy(true); setError('')
    setFolder(undefined); setFile(undefined); setImage(undefined)
    try {
      if (tile.kind === 'folder') { const result = await api.listFolder(tile.path!); if (revision === generation.current) setFolder(result) }
      else if (imageExtension.test(tile.path!)) { const result = await api.readImage(tile.path!); if (revision === generation.current) setImage(result) }
      else { const result = await api.readTextFile(tile.path!); if (revision === generation.current) setFile(result) }
    } catch (e) { if (revision === generation.current) setError(friendlyError(e)) }
    finally { if (revision === generation.current) setBusy(false) }
  }, [tile.kind, tile.path])
  useEffect(() => { void refresh(); setFilter(''); setSelected(0); return () => { generation.current++ } }, [refresh])
  useEffect(() => { rows.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }) }, [selected])
  // Navigating replaces the content, so keep focus in the tile for the next key.
  useEffect(() => { if (document.activeElement?.closest(`[data-tile-id="${tile.id}"]`) || document.activeElement === document.body) rows.current?.focus({ preventScroll: true }) }, [folder, tile.id])
  const go = async (path: string, how: 'here' | 'beside' | 'workspace' = 'here', record: 'push' | 'back' | 'forward' = 'push') => {
    try {
      const target = await api.inspectPath(path), input = fileTile(target.path, target.kind)
      if (how !== 'here') { open(input, how === 'beside' ? 'here' : 'new'); return }
      if (target.path === tile.path) return
      if (record === 'push') { history.back.push(tile.path!); history.forward = [] }
      if (record === 'back') history.forward.push(tile.path!)
      if (record === 'forward') history.back.push(tile.path!)
      replace(input); setVersion(v => v + 1)
    } catch (e) { setError(friendlyError(e)) }
  }
  const parent = tile.path!.replace(/\/[^/]+\/?$/, '') || '/'
  const back = () => { const previous = history.back.pop(); if (previous) void go(previous, 'here', 'back'); else if (parent !== tile.path) void go(parent) }
  const forward = () => { const next = history.forward.pop(); if (next) void go(next, 'here', 'forward') }
  const up = () => { if (parent !== tile.path) void go(parent) }
  const entries = folder?.entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) || []
  const how = (e: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }) => e.ctrlKey || e.metaKey ? e.shiftKey ? 'workspace' as const : 'beside' as const : 'here' as const
  const run = (action: Other) => { void Promise.resolve(action.run('here')).catch(e => setError(friendlyError(e))) }
  return <div className="files-body" data-arrow-keys onKeyDown={e => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); back(); return }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); forward(); return }
    if (e.key === '-' && !e.ctrlKey) { e.preventDefault(); up(); return }
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); void refresh(); return }
    const action = !e.ctrlKey && !e.metaKey && !e.altKey && actions.find(a => a.key === e.key)
    if (action) { e.preventDefault(); run(action); return }
    if (tile.kind !== 'folder') return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(0, Math.min(entries.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
    if (e.key === 'Enter') { e.preventDefault(); const entry = entries[selected]; if (entry && entry.kind !== 'other') void go(entry.path, how(e)) }
  }}>
    <div className="files-toolbar">
      <KeyButton label="Back" keys="⌫" disabled={!history.back.length && parent === tile.path} onClick={back}><ArrowLeft size={14} /></KeyButton>
      <KeyButton label="Forward" keys="Alt→" disabled={!history.forward.length} onClick={forward}><ArrowRight size={14} /></KeyButton>
      <KeyButton label="Parent folder" keys="-" disabled={parent === tile.path} data-back onClick={up}><ArrowUp size={14} /></KeyButton>
      <strong className="truncate" title={tile.path}>{tile.path}</strong>
      {actions.map(action => { const Icon = icons[action.icon || 'folder']; return <KeyButton key={action.label} label={action.label} keys={action.key} onClick={() => run(action)}><Icon size={14} /></KeyButton> })}
      <KeyButton label="Refresh files" keys="r" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /></KeyButton>
    </div>
    {error && <div className="inline-error" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
    {tile.kind === 'folder' ? <>
      <label className="files-filter filter-row"><input {...filterField} aria-label="Filter folder entries" placeholder="Filter this folder…" value={filter} onChange={e => { setFilter(e.target.value); setSelected(0) }} /><kbd aria-hidden>/</kbd></label>
      <div className="files-entries" role="list" aria-label="Folder entries" tabIndex={0} ref={rows}>{entries.map((entry, index) => <button disabled={entry.kind === 'other'} className={`file-entry ${selected === index ? 'selected' : ''}`} key={entry.path} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={e => void go(entry.path, how(e))}>{entry.kind === 'folder' ? <FolderOpen size={15} /> : imageExtension.test(entry.name) ? <FileImage size={15} /> : <FileText size={15} />}<span className="truncate">{entry.name}</span><small>{entry.kind === 'folder' ? 'Folder' : entry.kind === 'link' ? 'Link' : entry.kind === 'file' ? imageExtension.test(entry.name) ? 'Image' : 'File' : 'Unsupported'}</small></button>)}{!busy && folder && !entries.length && <p className="empty-list">{filter ? 'No entries match this filter.' : 'This folder is empty.'}</p>}</div>
    </> : image ? <div className="image-preview" tabIndex={0} ref={rows}><img src={image.dataURL} alt={tile.title} draggable={false} /></div>
      : <div className="file-preview" tabIndex={0} ref={rows}>{file?.reason ? <p className="empty-list">{file.reason}</p> : <pre>{file?.text}</pre>}</div>}
    {busy && <p className="empty-list">Loading files…</p>}
    <footer className="files-footer">↵ open here · Ctrl+↵ beside · ⌫ back · - up{folder?.truncated && ' · first 1,000 entries'}{file && ` · ${file.size.toLocaleString()} bytes`}{image && ` · image · ${image.size.toLocaleString()} bytes`}{file?.truncated && ' · preview limited to 256 KiB'} · read-only</footer>
  </div>
}
