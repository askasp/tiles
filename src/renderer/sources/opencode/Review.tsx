import { Check, Info } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileDiff } from '../../../shared/sources/opencode/types'
import { friendlyError, opencode } from './state'
import { Status } from '../../ui'
import { useTileActions } from '../../actions'

const modes = [['working', 'Uncommitted', 'u'], ['branch', 'All changes', 'a'], ['committed', 'Committed', 'c']] as const

export function Review({ tileID, directory }: { tileID: string; directory: string }) {
  const [mode, setMode] = useState<'working' | 'branch' | 'committed'>('working')
  const [files, setFiles] = useState<FileDiff[]>([])
  const [selected, setSelected] = useState('')
  const [reviewed, setReviewed] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const generation = useRef(0)
  const load = useCallback(async () => {
    const version = ++generation.current
    setLoading(true)
    try {
      const files = await opencode.diff({ directory, mode })
      if (version !== generation.current) return
      setFiles(files); setSelected(current => files.some(file => file.file === current) ? current : files[0]?.file || '')
      setError(undefined)
    } catch (error) { if (version === generation.current) setError(friendlyError(error)) }
    finally { if (version === generation.current) setLoading(false) }
  }, [directory, mode])
  useEffect(() => { void load(); return () => { generation.current++ } }, [load])
  const file = files.find(file => file.file === selected)
  const toggleReviewed = (path: string) => setReviewed(current => current.includes(path) ? current.filter(p => p !== path) : [...current, path])
  const diff = useRef<HTMLDivElement>(null)
  useTileActions(tileID, 'opencode-review', [
    ...(selected ? [{ id: 'mark', label: reviewed.includes(selected) ? 'Unmark reviewed' : 'Mark reviewed', key: 'm', run: () => toggleReviewed(selected) }] : []),
    ...modes.map(([key, title, letter]) => ({ id: `mode-${key}`, label: `Show ${title.toLowerCase()}`, key: letter, disabled: mode === key, run: () => setMode(key) })),
    { id: 'refresh', label: 'Refresh changes', key: 'r', run: () => void load() },
    { id: 'scroll', label: 'Scroll the diff', keyLabel: 'PgDn PgUp', run: () => diff.current?.scrollBy({ top: diff.current.clientHeight * 0.8 }) },
  ])
  return <div className="review-pane" tabIndex={0} onKeyDown={event => {
    if (event.key !== 'PageDown' && event.key !== 'PageUp') return
    event.preventDefault()
    diff.current?.scrollBy({ top: (event.key === 'PageDown' ? 1 : -1) * diff.current.clientHeight * 0.8 })
  }}>
    <div className="review-toolbar"><span className="review-mode">{modes.find(m => m[0] === mode)![1]}</span><span className="review-count">{reviewed.filter(path => files.some(f => f.file === path)).length}/{files.length} reviewed</span></div>
    {error ? <div className="stage-empty"><Info size={24} /><strong>Changes aren’t available</strong><span>{error}</span><span className="muted"><kbd>r</kbd> tries again</span></div>
      : loading && !files.length ? <div className="stage-empty"><Status running /><span>Loading changes…</span></div>
      : !files.length ? <div className="stage-empty"><Check size={24} strokeWidth={1.4} /><strong>No changes to review</strong><span>{mode === 'working' ? 'Your working directory is clean.' : 'No changes against the repository’s default base.'}</span></div>
      : <div className="review-content"><div className="review-files">{files.map(file => <div className={`review-file ${file.file === selected ? 'selected' : ''}`} key={file.file}>
        <span className={`review-checkbox ${reviewed.includes(file.file) ? 'checked' : ''}`} role="img" aria-label={reviewed.includes(file.file) ? 'Reviewed' : 'Not reviewed'} onClick={() => toggleReviewed(file.file)}>{reviewed.includes(file.file) && <Check size={10} />}</span>
        <button className="review-file-name truncate" title={file.file} onFocus={() => setSelected(file.file)} onClick={() => setSelected(file.file)}>{file.file}</button><span className="additions">+{file.additions}</span><span className="deletions">−{file.deletions}</span>
      </div>)}</div><div className="diff-content" ref={diff}><div className="diff-file-header">{file?.file}</div><div className="diff-lines">{file?.patch.split('\n').map((line, index) => <div key={index} className={`diff-line ${line.startsWith('+') && !line.startsWith('+++') ? 'added' : line.startsWith('-') && !line.startsWith('---') ? 'removed' : line.startsWith('@@') ? 'hunk' : ''}`}><span className="line-index">{index + 1}</span><code>{line || ' '}</code></div>)}</div></div></div>}
  </div>
}
