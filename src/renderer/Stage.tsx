import { ArrowLeft, ArrowRight, Camera, ExternalLink, Globe, RefreshCw, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BrowserState, StageTab } from '../shared/types'
import { normalizeURL } from '../shared/util'
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
      <IconButton label="Attach page" onClick={() => attachPage(tab.id)}><Send size={14} /></IconButton>
      {!standalone && <IconButton label="Attach screenshot" onClick={() => screenshot(tab.id)}><Camera size={15} /></IconButton>}
      <IconButton label="Page developer tools" onClick={() => void action('devtools')}><ExternalLink size={14} /></IconButton>
    </div>
    <div className="browser-surface" data-browser-id={tab.id} data-browser-url={tab.url}>
      <span className="browser-loading">{state?.error ? `Could not load page: ${state.error}` : 'Opening browser…'}</span>
    </div>
    {state?.error && <div className="browser-error">{state.error}<button className="text-button" onClick={() => void action('reload')}>Retry</button><button className="text-button" onClick={() => openAddress(tab.id)}>Change URL</button></div>}
  </div>
}
