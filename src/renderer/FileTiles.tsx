import { ArrowUp, FileText, FolderOpen, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FolderPage, TextFile } from '../shared/types'
import { fileTile, projectTile, type OpenMode, type Tile, type TileInput } from '../shared/tiles'
import { api, friendlyError } from './data'
import { IconButton } from './ui'

export function FileBody({ tile, open, create }: { tile: Tile; open: (input: TileInput, mode?: OpenMode) => void; create: (directory: string) => void }) {
  const [folder, setFolder] = useState<FolderPage>()
  const [file, setFile] = useState<TextFile>()
  const [filter, setFilter] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(0)
  const generation = useRef(0), rows = useRef<HTMLDivElement>(null)
  const refresh = useCallback(async () => {
    const revision = ++generation.current; setBusy(true); setError('')
    try {
      if (tile.kind === 'folder') { const result = await api.listFolder(tile.path!); if (revision === generation.current) setFolder(result) }
      else { const result = await api.readTextFile(tile.path!); if (revision === generation.current) setFile(result) }
    } catch (e) { if (revision === generation.current) setError(friendlyError(e)) }
    finally { if (revision === generation.current) setBusy(false) }
  }, [tile.kind, tile.path])
  useEffect(() => { void refresh(); return () => { generation.current++ } }, [refresh])
  useEffect(() => { rows.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }) }, [selected])
  const openPath = async (path: string, mode: OpenMode = 'here') => {
    try { const target = await api.inspectPath(path); open(fileTile(target.path, target.kind), mode) }
    catch (e) { setError(friendlyError(e)) }
  }
  const entries = folder?.entries.filter(e => e.name.toLowerCase().includes(filter.toLowerCase())) || []
  return <div className="files-body">
    <div className="files-toolbar"><strong className="truncate" title={tile.path}>{tile.path}</strong><IconButton label="Refresh files" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /></IconButton>{folder && folder.parent !== folder.path && <button className="pill" onClick={() => void openPath(folder.parent)}><ArrowUp size={13} />Parent folder</button>}</div>
    {error && <div className="inline-error" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
    {tile.kind === 'folder' ? <>
      <div className="files-actions"><button className="pill" onClick={() => open(projectTile(tile.path!))}>Show OpenCode sessions</button><button className="text-button" onClick={() => create(tile.path!)}>Start OpenCode session here</button></div>
      <label className="files-filter"><input aria-label="Filter folder entries" placeholder="Filter this folder…" value={filter} onChange={e => { setFilter(e.target.value); setSelected(0) }} /></label>
      <div className="files-entries" role="list" aria-label="Folder entries" tabIndex={0} ref={rows} onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(0, Math.min(entries.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
        if (e.key === 'Enter') { e.preventDefault(); const entry = entries[selected]; if (entry && entry.kind !== 'other') void openPath(entry.path, e.shiftKey ? 'move' : e.ctrlKey ? 'new' : 'here') }
      }}>{entries.map((entry, index) => <button disabled={entry.kind === 'other'} className={`file-entry ${selected === index ? 'selected' : ''}`} key={entry.path} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={e => void openPath(entry.path, e.shiftKey ? 'move' : e.ctrlKey ? 'new' : 'here')}>{entry.kind === 'folder' ? <FolderOpen size={15} /> : <FileText size={15} />}<span className="truncate">{entry.name}</span><small>{entry.kind === 'folder' ? 'Folder · Browse' : entry.kind === 'link' ? 'Link · Open target' : entry.kind === 'file' ? 'File · Read text' : 'Unsupported'}</small></button>)}{!busy && folder && !entries.length && <p className="empty-list">{filter ? 'No entries match this filter.' : 'This folder is empty.'}</p>}</div>
    </> : <div className="file-preview" tabIndex={0}>{file?.reason ? <p className="empty-list">{file.reason}</p> : <pre>{file?.text}</pre>}</div>}
    {busy && <p className="empty-list">Loading files…</p>}
    <footer className="files-footer">Files · Read-only{folder?.truncated && ' · First 1,000 entries only'}{file && ` · ${file.size.toLocaleString()} bytes`}{file?.truncated && ' · Preview limited to 256 KiB'} · Opening files never creates a session</footer>
  </div>
}
