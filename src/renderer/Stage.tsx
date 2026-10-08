import { ArrowLeft, ArrowRight, Camera, Check, Columns2, Expand, ExternalLink, Globe, Info, Minus, PanelTop, Plus, RefreshCw, Rows2, Send, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserState, FileDiff, SessionDetail, StageTab, Workspace } from '../shared/types'
import { basename, normalizeURL, uid } from '../shared/workspaces'
import { api, friendlyError } from './data'
import { IconButton, Status, shortPath } from './ui'

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

function Details({ detail, workspace, home }: { detail?: SessionDetail; workspace: Workspace; home: string }) {
  const session = detail?.session
  return <div className="session-details"><h2>Session details</h2><p className="muted">One session, one workspace. OpenCode keeps running independently of this window.</p>
    <dl><dt>Project folder</dt><dd>{shortPath(workspace.directory || '', home)}</dd><dt>Agent</dt><dd>{session?.agent || 'Server default'}</dd><dt>Model</dt><dd>{session?.model ? `${session.model.providerID} / ${session.model.id}${session.model.variant ? ` · ${session.model.variant}` : ''}` : 'Server default'}</dd><dt>Created</dt><dd>{session ? new Date(session.time.created).toLocaleString() : '—'}</dd><dt>Session ID</dt><dd>{workspace.sessionID}</dd><dt>Total cost</dt><dd>${(session?.cost || 0).toFixed(4)}</dd><dt>Output tokens</dt><dd>{(session?.tokens.output || 0).toLocaleString()}</dd></dl>
    <div className="detail-note">Close this workspace with its × button. Reopen it from Home or the launcher—your draft, tabs and layout will still be here.</div>
  </div>
}

interface StageProps {
  workspace: Workspace
  update: (change: (workspace: Workspace) => Workspace) => void
  browserStates: Record<string, BrowserState>
  detail?: SessionDetail
  home: string
  newBrowser: () => void
  openAddress: (id?: string) => void
  addUtility: (kind: 'review' | 'details') => void
  selectTab: (id: string) => void
  closeTab: (id: string) => void
  split: (direction: 'vertical' | 'horizontal') => void
  move: () => void
  attachPage: (id: string) => void
  screenshot: (id: string) => void
  reportError: (message: string) => void
  onPopoverChange: (open: boolean) => void
}

export function Stage(props: StageProps) {
  const { workspace } = props
  const [menu, setMenu] = useState<0 | 1 | null>(null)
  useEffect(() => { props.onPopoverChange(menu !== null); return () => props.onPopoverChange(false) }, [menu, props.onPopoverChange])
  const panes = workspace.split ? [0, 1] as const : [0] as const
  return <div className={`stage ${workspace.split || ''}`}>
    {panes.filter(pane => !workspace.fullscreen || pane === workspace.focusedPane).map(pane => {
      const tab = workspace.tabs.find(tab => tab.id === workspace.panes[pane])
      const tabs = workspace.tabs.filter(tab => (workspace.tabPane[tab.id] ?? 0) === pane)
      return <section className={`stage-pane ${workspace.focusedPane === pane && workspace.split ? 'focused-pane' : ''}`} key={pane} onMouseDown={() => props.update(w => w.focusedPane === pane ? w : { ...w, focusedPane: pane })}>
        <header className="stage-tabs">
          <div className="stage-tab-list">{tabs.map(item => <div className={`stage-tab ${item.id === tab?.id ? 'selected' : ''}`} key={item.id}>
            <button className="stage-tab-select" onClick={() => props.selectTab(item.id)} title={item.title}>{item.kind === 'browser' ? <Globe size={13} /> : item.kind === 'review' ? <Minus size={13} /> : <Info size={13} />}<span className="truncate">{item.kind === 'browser' ? props.browserStates[item.id]?.title || item.title : item.title}</span></button>
            <IconButton label={`Close ${item.title} tab`} className="tab-close" onClick={() => props.closeTab(item.id)}><X size={11} /></IconButton>
          </div>)}</div>
          <div className="tab-add"><IconButton label="Open a stage tab" onClick={() => setMenu(menu === pane ? null : pane)}><Plus size={15} /></IconButton>
            {menu === pane && <><div className="menu-dismiss" onClick={() => setMenu(null)} /><div className="popover tab-menu">
              <button aria-label="Browser" onClick={() => { setMenu(null); props.newBrowser() }}><Globe size={14} />Browser<span>Ctrl+T</span></button>
              {workspace.kind === 'session' && <><button onClick={() => { setMenu(null); props.addUtility('review') }}><Minus size={14} />Review changes</button><button onClick={() => { setMenu(null); props.addUtility('details') }}><Info size={14} />Session details</button></>}
            </div></>}
          </div>
          <div className="stage-window-controls">
            {workspace.split && <IconButton label="Move tab to other pane" onClick={props.move}><ArrowRight size={14} /></IconButton>}
            <IconButton label={workspace.split === 'vertical' ? 'Unsplit stage' : 'Split stage side by side'} className={workspace.split === 'vertical' ? 'active-icon' : ''} onClick={() => props.split('vertical')}><Columns2 size={14} /></IconButton>
            <IconButton label={workspace.split === 'horizontal' ? 'Unsplit stage' : 'Split stage stacked'} className={workspace.split === 'horizontal' ? 'active-icon' : ''} onClick={() => props.split('horizontal')}><Rows2 size={14} /></IconButton>
            <IconButton label={workspace.fullscreen ? 'Exit pane fullscreen' : 'Fullscreen pane'} onClick={() => props.update(w => ({ ...w, fullscreen: !w.fullscreen }))}><Expand size={14} /></IconButton>
          </div>
        </header>
        <div className="stage-pane-content">
          {!tab ? <div className="stage-empty"><PanelTop size={29} strokeWidth={1.2} /><strong>Nothing on the stage yet</strong><span>Keep your conversation on the left.<br />Open a browser or review changes here.</span><div className="button-row"><button className="pill" onClick={props.newBrowser}><Globe size={13} />Open URL<kbd>Ctrl+L</kbd></button>{workspace.kind === 'session' && <button className="pill" onClick={() => props.addUtility('review')}><Minus size={13} />Review changes</button>}</div></div>
            : tab.kind === 'browser' ? <BrowserPane tab={tab} state={props.browserStates[tab.id]} openAddress={props.openAddress} attachPage={props.attachPage} screenshot={props.screenshot} standalone={workspace.kind === 'web'} reportError={props.reportError} />
            : tab.kind === 'review' ? <Review directory={workspace.directory || ''} reportError={props.reportError} />
            : <Details detail={props.detail} workspace={workspace} home={props.home} />}
        </div>
      </section>
    })}
  </div>
}
