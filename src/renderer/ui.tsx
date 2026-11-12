import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { actionForKey } from './actions'

/** The system modifier as people read it: ⌘ on macOS, Super elsewhere (Ctrl+Alt also works on Linux). */
export const systemKey = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Super'

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>
}

export function Status({ running, waiting, unread = false }: { running?: boolean; waiting?: boolean; unread?: boolean }) {
  if (waiting) return <span className="status-dot amber" aria-label="Waiting for you" />
  if (running) return <LoaderCircle size={13} className="spinner" aria-label="Running" />
  if (unread) return <span className="status-dot blue" aria-label="Unread" />
  return <span className="status-spacer" />
}

export function ProjectBadge({ name, small = false }: { name: string; small?: boolean }) {
  return <span className={`project-badge ${small ? 'small' : ''}`}>{name.slice(0, 1).toUpperCase()}</span>
}

export function shortPath(path: string, home: string) {
  return path === home ? '~' : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

export function relativeTime(time: number) {
  const difference = Math.max(0, Date.now() - time)
  if (difference < 60_000) return 'just now'
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}m ago`
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}h ago`
  if (difference < 604_800_000) return `${Math.floor(difference / 86_400_000)}d ago`
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function dayLabel(time: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const date = new Date(time); date.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - date.getTime()) / 86_400_000)
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

/** A dialog starts on what you came for: a field, else the first row, else a button — never the Close button. */
function firstFocus(element: HTMLElement) {
  for (const selector of ['[autofocus]', 'input:not(:disabled), textarea:not(:disabled), select:not(:disabled)', `${rowSelector}, .action-row`, '[tabindex="0"]', 'button:not(:disabled)']) {
    const found = [...element.querySelectorAll<HTMLElement>(selector)].find(e => !e.closest('.modal-heading') && (e as HTMLButtonElement).disabled !== true)
    if (found) return found
  }
  return element
}

export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLElement>(null)
  const previous = useRef(document.activeElement as HTMLElement | null)
  useEffect(() => {
    const element = dialog.current
    if (element && !element.contains(document.activeElement)) firstFocus(element).focus()
    // When the window gets the keyboard back (e.g. from a web page), Chromium restores the last
    // focused element, which may be outside this dialog. The dialog takes it back.
    const reclaim = () => { const e = dialog.current; if (e && !e.contains(document.activeElement)) firstFocus(e).focus() }
    window.addEventListener('focus', reclaim)
    return () => { window.removeEventListener('focus', reclaim); const back = previous.current; if (back?.isConnected && !back.closest('.resource-tile:not(.tile-focused)')) back.focus() }
  }, [])
  return <div className="modal-scrim" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
    <section ref={dialog} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close() }
      if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]')].filter(e => e.getClientRects().length > 0)
      const first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); event.currentTarget.focus() }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last!.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
      {children}
    </section>
  </div>
}

export const rowSelector = '.session-row, .file-entry, .recipe-list-row, .recipe-timeline-row, .recipe-table tbody tr button, .review-file-name, .overview-tile-row, .k-row'
/** Keys of the focused tile, never while typing: ␣ action menu, ? key sheet, / filter,
 * the tile's own action letters, j/k through rows, l opens, h goes back. */
export function listKeys(event: KeyboardEvent, open: { menu(): void; keys(): void }) {
  // Delete (⌘⌫ on a Mac) is the tile's D action: delete or trash, always confirmed.
  const remove = (event.key === 'Delete' && !event.ctrlKey && !event.altKey && !event.metaKey) || (event.key === 'Backspace' && event.metaKey)
  if (remove && !(event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) {
    const tile = document.querySelector<HTMLElement>('.resource-tile.tile-focused'), action = tile && actionForKey(tile.dataset.tileId!, 'D')
    if (action) { event.preventDefault(); void action.run() }
    return
  }
  if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return
  const target = event.target as HTMLElement | null
  if (!target || target.closest('input, textarea, select, [contenteditable="true"]')) return
  if (event.key === '?') { event.preventDefault(); open.keys(); return }
  // The leader needs no tile: its g, n, s and z work on an empty desktop too.
  if (event.key === ' ') { event.preventDefault(); open.menu(); return }
  // The focused tile wins over stale DOM focus left in the tile focus came from.
  const tile = document.querySelector<HTMLElement>('.resource-tile.tile-focused') || target.closest<HTMLElement>('[data-tile-id]')
  if (!tile) return
  if (event.key === '/') {
    const filter = tile.querySelector<HTMLInputElement>('[data-filter]')
    if (filter) { event.preventDefault(); filter.focus(); filter.select() }
    return
  }
  const action = actionForKey(tile.dataset.tileId!, event.key)
  if (action) { event.preventDefault(); void action.run(); return }
  if (!['j', 'k', 'h', 'l'].includes(event.key)) return
  const inside = tile.contains(target)
  // Lists that handle arrows themselves (Files) get arrows.
  const own = (inside && target.closest<HTMLElement>('[data-arrow-keys]')) || tile.querySelector<HTMLElement>('[data-arrow-keys]')
  if (own) {
    event.preventDefault()
    const key = { j: 'ArrowDown', k: 'ArrowUp', l: 'Enter', h: 'Backspace' }[event.key]!
    own.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    return
  }
  const rows = [...tile.querySelectorAll<HTMLElement>(rowSelector)].filter(row => row.getClientRects().length && !(row as HTMLButtonElement).disabled)
  if (!rows.length) return
  event.preventDefault()
  const at = inside ? rows.indexOf(target.closest<HTMLElement>(rowSelector) as HTMLElement) : -1
  if (event.key === 'j' || event.key === 'k') rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (event.key === 'j' ? 1 : -1)))].focus()
  if (event.key === 'l' && at >= 0) rows[at].click()
  if (event.key === 'h') tile.querySelector<HTMLElement>('[data-back]')?.click()
}

/** A tile's filter field: / gets here, and Esc, ↓ or Enter (outside a form) go back to the list for j/k. */
export const filterField = {
  'data-filter': true,
  onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (!(event.key === 'Escape' || event.key === 'ArrowDown' || (event.key === 'Enter' && !event.currentTarget.form))) return
    const tile = event.currentTarget.closest<HTMLElement>('[data-tile-id]')
    if (!tile) return
    event.preventDefault()
    const row = [...tile.querySelectorAll<HTMLElement>(rowSelector)].find(row => row.getClientRects().length && !(row as HTMLButtonElement).disabled)
    ;(row || tile.querySelector<HTMLElement>('[data-arrow-keys][tabindex="0"], [data-arrow-keys] [tabindex="0"]') || tile).focus()
  },
}

/** An icon button that shows the key that does the same thing. */
export function KeyButton({ label, keys, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; keys?: string; children: ReactNode }) {
  return <button type="button" className={`key-button ${className}`} aria-label={label} title={keys ? `${label} · ${keys}` : label} {...props}>{children}{keys && <kbd>{keys}</kbd>}</button>
}

/** When something last changed, short: “12m”, “09:02” (yesterday), “Mon”, “Sep 30”. */
export function when(time: number, now = Date.now()) {
  const day = (t: number) => new Date(t).toDateString(), minutes = Math.round((now - time) / 60_000)
  if (day(time) === day(now)) return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`
  if (now - time < 7 * 86_400_000) return new Date(time).toLocaleString('en', day(time) === day(now - 86_400_000) ? { hour: '2-digit', minute: '2-digit', hour12: false } : { weekday: 'short' })
  return new Date(time).toLocaleString('en', { month: 'short', day: 'numeric' })
}
/** The day group a list shows something under. */
export function groupOf(time: number, now = Date.now()): 'Today' | 'Yesterday' | 'This week' | 'Older' {
  const day = (t: number) => new Date(t).toDateString()
  return day(time) === day(now) ? 'Today' : day(time) === day(now - 86_400_000) ? 'Yesterday' : now - time < 7 * 86_400_000 ? 'This week' : 'Older'
}
/** “Today 09:41”, “Sep 30 16:40”. */
export const whenLong = (time: number) => `${groupOf(time) === 'Older' || groupOf(time) === 'This week' ? new Date(time).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : groupOf(time)} ${new Date(time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })}`
/** True while the element is at least `width` wide: list tiles show a peek when they have the room. */
export function useWide(ref: RefObject<HTMLElement | null>, width: number) {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, width])
  return wide
}
/** The keys a list or peek answers to, along its bottom edge. */
export function KeyHints({ hints }: { hints: [key: string, label: string][] }) {
  return <footer className="key-hints">{hints.map(([key, label]) => <span key={key}><kbd>{key}</kbd>{label}</span>)}</footer>
}
