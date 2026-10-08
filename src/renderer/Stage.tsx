import { ArrowLeft, ArrowRight, Camera, Check, ExternalLink, Globe, Info, RefreshCw, Send } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserState, FileDiff, StageTab } from '../shared/types'
import { normalizeURL } from '../shared/workspaces'
import { api, friendlyError } from './data'
import { IconButton, Status } from './ui'

export function BrowserPane({ tab, state, openAddress, attachPage, screenshot, standalone, reportError, navigate }: {
  tab: Extract<StageTab, { kind: 'browser' }>; state?: BrowserState; openAddress: (id: string) => void;
  attachPage: (id: string) => void; screenshot: (id: string) => void; standalone: boolean; reportError: (message: string) => void;
  navigate?: (url: string) => void;
}) {
  const [address, setAddress] = useState(state?.url || tab.url)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { setAddress(state?.url || tab.url) }, [state?.url, tab.url])
  async function action(action: 'back' | 'forward' | 'reload' | 'navigate' | 'devtools') {
    try { if (action === 'navigate' && navigate) navigate(normalizeURL(address)); else await api.browserAction({ id: tab.id, action, ...(action === 'navigate' && { url: normalizeURL(address) }) }) }
    catch (error) { reportError(friendlyError(error)) }
  }
  return <div className="browser-pane">
    <div className="browser-toolbar">
      <IconButton label="Back" disabled={!state?.canGoBack} onClick={() => void action('back')}><ArrowLeft size={15} /></IconButton>
      <IconButton label="Forward" disabled={!state?.canGoForward} onClick={() => void action('forward')}><ArrowRight size={15} /></IconButton>
      <IconButton label="Reload page" onClick={() => void action('reload')}>{state?.loading ? <Status running /> : <RefreshCw size={14} />}</IconButton>
      <form className="address-bar" onSubmit={event => { event.preventDefault(); void action('navigate'); input.current?.blur() }}><Globe size={12} /><input ref={input} data-address-for={tab.id} aria-label="Browser address" value={address} onChange={event => setAddress(event.target.value)} onFocus={event => event.target.select()} /></form>
      <IconButton label="Attach page to session" onClick={() => attachPage(tab.id)}><Send size={14} /></IconButton>
      {!standalone && <IconButton label="Attach screenshot" onClick={() => screenshot(tab.id)}><Camera size={15} /></IconButton>}
      <IconButton label="Page developer tools" onClick={() => void action('devtools')}><ExternalLink size={14} /></IconButton>
    </div>
    <div className="browser-surface" data-browser-id={tab.id} data-browser-url={tab.url}>
      <span className="browser-loading">{state?.error ? `Could not load page: ${state.error}` : 'Opening browser…'}</span>
    </div>
    {state?.error && <div className="browser-error">{state.error}<button className="text-button" onClick={() => void action('reload')}>Retry</button><button className="text-button" onClick={() => openAddress(tab.id)}>Change URL</button></div>}
  </div>
}

export function Review({ directory, reportError }: { directory: string; reportError: (message: string) => void }) {
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
      const files = await api.diff({ directory, mode })
      if (version !== generation.current) return
      setFiles(files); setSelected(current => files.some(file => file.file === current) ? current : files[0]?.file || '')
      setError(undefined)
    } catch (error) { if (version === generation.current) setError(friendlyError(error)) }
    finally { if (version === generation.current) setLoading(false) }
  }, [directory, mode])
  useEffect(() => { void load(); return () => { generation.current++ } }, [load])
  const file = files.find(file => file.file === selected)
  const toggleReviewed = (path: string) => setReviewed(current => current.includes(path) ? current.filter(p => p !== path) : [...current, path])
  return <div className="review-pane" tabIndex={0} onKeyDown={event => {
    if (event.target !== event.currentTarget) return
    const index = files.findIndex(file => file.file === selected)
    if (event.key === 'j' || event.key === 'k') { event.preventDefault(); setSelected(files[Math.max(0, Math.min(files.length - 1, index + (event.key === 'j' ? 1 : -1)))]?.file || '') }
    if (event.key === 'm' && selected) toggleReviewed(selected)
  }}>
    <div className="review-toolbar"><div className="segmented-control">{([['working', 'Uncommitted'], ['branch', 'All changes'], ['committed', 'Committed']] as const).map(([key, title]) => <button key={key} className={mode === key ? 'selected' : ''} onClick={() => setMode(key)}>{title}</button>)}</div><span className="review-count">{reviewed.filter(path => files.some(f => f.file === path)).length}/{files.length} reviewed</span><IconButton label="Refresh changes" onClick={() => void load()}><RefreshCw size={13} /></IconButton></div>
    {error ? <div className="stage-empty"><Info size={24} /><strong>Changes aren’t available</strong><span>{error}</span><button className="pill" onClick={() => void load()}>Try again</button></div>
      : loading && !files.length ? <div className="stage-empty"><Status running /><span>Loading changes…</span></div>
      : !files.length ? <div className="stage-empty"><Check size={24} strokeWidth={1.4} /><strong>No changes to review</strong><span>{mode === 'working' ? 'Your working directory is clean.' : 'No changes against the repository’s default base.'}</span></div>
      : <div className="review-content"><div className="review-files">{files.map(file => <div className={`review-file ${file.file === selected ? 'selected' : ''}`} key={file.file}>
        <button className={`review-checkbox ${reviewed.includes(file.file) ? 'checked' : ''}`} aria-label={`Mark ${file.file} reviewed`} onClick={() => toggleReviewed(file.file)}>{reviewed.includes(file.file) && <Check size={10} />}</button>
        <button className="review-file-name truncate" title={file.file} onClick={() => setSelected(file.file)}>{file.file}</button><span className="additions">+{file.additions}</span><span className="deletions">−{file.deletions}</span>
      </div>)}</div><div className="diff-content"><div className="diff-file-header">{file?.file}</div><div className="diff-lines">{file?.patch.split('\n').map((line, index) => <div key={index} className={`diff-line ${line.startsWith('+') && !line.startsWith('+++') ? 'added' : line.startsWith('-') && !line.startsWith('---') ? 'removed' : line.startsWith('@@') ? 'hunk' : ''}`}><span className="line-index">{index + 1}</span><code>{line || ' '}</code></div>)}</div></div></div>}
  </div>
}
