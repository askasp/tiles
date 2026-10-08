import { Globe } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { BrowserState, StageTab } from '../shared/types'
import { normalizeURL } from '../shared/util'
import { api, friendlyError } from './data'
import { Status } from './ui'
import { useTileActions } from './actions'

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
  const focusAddress = () => { input.current?.focus(); input.current?.select() }
  useTileActions(tab.id, 'browser', [
    { id: 'page-back', label: 'Back in the page', key: 'b', keyLabel: 'Alt+←', disabled: !state?.canGoBack, run: () => void action('back') },
    { id: 'page-forward', label: 'Forward in the page', key: 'n', keyLabel: 'Alt+→', disabled: !state?.canGoForward, run: () => void action('forward') },
    { id: 'reload', label: 'Reload the page', key: 'r', keyLabel: 'Ctrl+R', run: () => void action('reload') },
    { id: 'address', label: 'Go to another address', key: 'g', keyLabel: 'Ctrl+L', run: focusAddress },
    { id: 'attach', label: 'Attach the page as context', key: 'a', run: () => attachPage(tab.id) },
    ...(!standalone ? [{ id: 'screenshot', label: 'Attach a screenshot', key: 's', run: () => screenshot(tab.id) }] : []),
    { id: 'devtools', label: 'Page developer tools', key: 'd', run: () => void action('devtools') },
  ])
  return <div className="browser-pane">
    <div className="browser-toolbar">
      <form className="address-bar" onSubmit={event => { event.preventDefault(); void action('navigate'); input.current?.blur() }}>{state?.loading ? <Status running /> : <Globe size={12} />}<input ref={input} data-address-for={tab.id} aria-label="Browser address" value={address} onChange={event => setAddress(event.target.value)} onFocus={event => event.target.select()} /></form>
    </div>
    <div className="browser-surface" data-browser-id={tab.id} data-browser-url={tab.url}>
      <span className="browser-loading">{state?.error ? `Could not load page: ${state.error}` : 'Opening browser…'}</span>
    </div>
    {state?.error && <div className="browser-error">{state.error}<span className="muted"><kbd>Ctrl+R</kbd> retry · <kbd>Ctrl+L</kbd> change the address</span></div>}
  </div>
}
