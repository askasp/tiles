import { FileImage, FileText, FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderPage, TextFile } from '../shared/types'
import { fileTile, type Tile } from '../shared/tiles'
import { api, friendlyError } from './data'
import { filterField } from './ui'
import { useTileActions } from './actions'
import { listOpen, type Env, type ListOpen, type Other } from './sources/types'

const imageExtension = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i

/** Folder or file. ↵ goes into it in this tile, Ctrl+↵ beside, Ctrl+Shift+↵ in a new workspace.
 * ⌫ / h go back (to the parent when there is no history), - goes up; the rest is in the action menu. */
export function FileBody({ tile, env, others }: { tile: Tile; env: Env; others: Other[] }) {
  const [folder, setFolder] = useState<FolderPage>()
  const [file, setFile] = useState<TextFile>()
  const [image, setImage] = useState<{ dataURL: string; size: number }>()
  const [filter, setFilter] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(0)
  const generation = useRef(0), rows = useRef<HTMLDivElement>(null)
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
  const go = async (path: string, how: ListOpen = 'replace') => {
    try {
      const target = await api.inspectPath(path)
      if (how === 'replace' && target.path === tile.path) return
      env.openFrom(tile.id, fileTile(target.path, target.kind), how)
    } catch (e) { setError(friendlyError(e)) }
  }
  const parent = tile.path!.replace(/\/[^/]+\/?$/, '') || '/'
  const back = () => { if (!env.tileBack(tile.id) && parent !== tile.path) void go(parent) }
  const up = () => { if (parent !== tile.path) void go(parent) }
  const entries = folder?.entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) || []
  const current = tile.kind === 'folder' ? entries[selected] : undefined
  const run = (action: Other) => { void Promise.resolve(action.run('here')).catch(e => setError(friendlyError(e))) }
  useTileActions(tile.id, 'files', [
    { id: 'up', label: 'Parent folder', key: '-', disabled: parent === tile.path, run: up },
    ...(current && current.kind !== 'other' ? [
      { id: 'beside', label: `Open ${current.name} beside`, keyLabel: 'Ctrl+↵', run: () => void go(current.path, 'beside') },
      { id: 'workspace', label: `Open ${current.name} in a new workspace`, keyLabel: 'Ctrl+Shift+↵', run: () => void go(current.path, 'workspace') },
    ] : []),
    ...others.map((action, index) => ({ id: `other-${index}`, label: action.label, key: action.key, run: () => run(action) })),
    { id: 'refresh', label: 'Refresh', key: 'r', disabled: busy, run: () => void refresh() },
    // No key yet: the keymap is being settled. Always asks first; the Trash can restore it.
    ...(tile.kind === 'folder' ? current && current.kind !== 'other' ? [{ id: 'delete', label: `Move “${current.name}” to the Trash…`, run: () => void api.trashPath(current.path).then(() => refresh()).catch(e => setError(friendlyError(e))) }] : []
      : [{ id: 'delete', label: `Move “${tile.title}” to the Trash…`, run: () => void api.trashPath(tile.path!).then(() => { if (!env.tileBack(tile.id)) void go(parent) }).catch(e => setError(friendlyError(e))) }]),
  ])
  return <div className="files-body" data-arrow-keys onKeyDown={e => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); back(); return }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); env.tileForward(tile.id); return }
    if (tile.kind !== 'folder') return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(0, Math.min(entries.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
    if (e.key === 'Enter') { e.preventDefault(); if (current && current.kind !== 'other') void go(current.path, listOpen(e)) }
  }}>
    <div className="files-toolbar"><strong className="truncate" title={tile.path}>{tile.path}</strong></div>
    {error && <div className="inline-error" role="alert">{error}<span className="muted"><kbd>r</kbd> retries</span></div>}
    {tile.kind === 'folder' ? <>
      <label className="files-filter filter-row"><input {...filterField} aria-label="Filter folder entries" placeholder="Filter this folder…" value={filter} onChange={e => { setFilter(e.target.value); setSelected(0) }} /><kbd aria-hidden>/</kbd></label>
      <div className="files-entries" role="list" aria-label="Folder entries" tabIndex={0} ref={rows}>{entries.map((entry, index) => <button disabled={entry.kind === 'other'} className={`file-entry ${selected === index ? 'selected' : ''}`} key={entry.path} onFocus={() => setSelected(index)} onClick={e => void go(entry.path, listOpen(e))}>{entry.kind === 'folder' ? <FolderOpen size={15} /> : imageExtension.test(entry.name) ? <FileImage size={15} /> : <FileText size={15} />}<span className="truncate">{entry.name}</span><small>{entry.kind === 'folder' ? 'Folder' : entry.kind === 'link' ? 'Link' : entry.kind === 'file' ? imageExtension.test(entry.name) ? 'Image' : 'File' : 'Unsupported'}</small></button>)}{!busy && folder && !entries.length && <p className="empty-list">{filter ? 'No entries match this filter.' : 'This folder is empty.'}</p>}</div>
    </> : image ? <div className="image-preview" tabIndex={0} ref={rows}><img src={image.dataURL} alt={tile.title} draggable={false} /></div>
      : <div className="file-preview" tabIndex={0} ref={rows}>{file?.reason ? <p className="empty-list">{file.reason}</p> : <pre>{file?.text}</pre>}</div>}
    {busy && <p className="empty-list">Loading files…</p>}
    <footer className="files-footer">↵ open · Ctrl+↵ beside · ⌫ back · - up · ␣ more{folder?.truncated && ' · first 1,000 entries'}{file && ` · ${file.size.toLocaleString()} bytes`}{image && ` · image · ${image.size.toLocaleString()} bytes`}{file?.truncated && ' · preview limited to 256 KiB'} · read-only</footer>
  </div>
}
