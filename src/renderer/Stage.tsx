import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BrowserState, StageTab } from '../shared/types'
import { api, friendlyError } from './data'
import { Status } from './ui'
import { useTileActions } from './actions'

/** A page in a tile, like an installed web app: no address bar. One page per tile, so another
 * address (Ctrl+L, Alt+D, F6) opens in its own tile, or goes to the one that has it. */
export function BrowserPane({ tab, state, openAddress, attachPage, screenshot, standalone, reportError }: {
  tab: Extract<StageTab, { kind: 'browser' }>; state?: BrowserState; openAddress: (id: string) => void;
  attachPage: (id: string) => void; screenshot: (id: string) => void; standalone: boolean; reportError: (message: string) => void;
}) {
  async function action(action: 'back' | 'forward' | 'reload' | 'devtools') {
    try { await api.browserAction({ id: tab.id, action }) }
    catch (error) { reportError(friendlyError(error)) }
  }
  useTileActions(tab.id, 'browser', [
    { id: 'page-back', label: 'Back in the page', key: 'b', keyLabel: 'Alt+←', disabled: !state?.canGoBack, run: () => void action('back') },
    { id: 'page-forward', label: 'Forward in the page', key: 'n', keyLabel: 'Alt+→', disabled: !state?.canGoForward, run: () => void action('forward') },
    { id: 'reload', label: 'Reload the page', key: 'r', keyLabel: 'Ctrl+R', run: () => void action('reload') },
    { id: 'address', label: 'Open another address in its own tile', key: 'g', keyLabel: 'Ctrl+L', run: () => openAddress(tab.id) },
    { id: 'attach', label: 'Attach the page as context', key: 'a', run: () => attachPage(tab.id) },
    ...(!standalone ? [{ id: 'screenshot', label: 'Attach a screenshot', key: 's', run: () => screenshot(tab.id) }] : []),
    { id: 'devtools', label: 'Page developer tools', key: 'd', run: () => void action('devtools') },
  ])
  // Loading shows as a dot in the tile's own header.
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => { setSlot(document.querySelector<HTMLElement>(`[data-header-slot="${CSS.escape(tab.id)}"]`)) }, [tab.id])
  return <div className="browser-pane">
    {slot && state?.loading && createPortal(<Status running />, slot)}
    <div className="browser-surface" data-browser-id={tab.id} data-browser-url={tab.url}>
      <span className="browser-loading">{state?.error ? `Could not load page: ${state.error}` : 'Opening browser…'}</span>
    </div>
    {state?.error && <div className="browser-error">{state.error}<span className="muted"><kbd>Ctrl+R</kbd> retry · <kbd>Ctrl+L</kbd> open another address</span></div>}
  </div>
}
