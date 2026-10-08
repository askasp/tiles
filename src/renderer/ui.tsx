import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect, useRef } from 'react'

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

export function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLElement>(null)
  const previous = useRef(document.activeElement as HTMLElement | null)
  useEffect(() => {
    const element = dialog.current
    if (element && !element.contains(document.activeElement)) {
      const first = element.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex="0"]')
      ;(first || element).focus()
    }
    // When the window gets the keyboard back (e.g. from a web page), Chromium restores the last
    // focused element, which may be outside this dialog. The dialog takes it back.
    const reclaim = () => { const e = dialog.current; if (e && !e.contains(document.activeElement)) (e.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex="0"]') || e).focus() }
    window.addEventListener('focus', reclaim)
    return () => { window.removeEventListener('focus', reclaim); if (previous.current?.isConnected) previous.current.focus() }
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

const rowSelector = '.session-row, .file-entry, .recipe-list-row, .recipe-timeline-row, .recipe-table tbody tr button, .front-conversation-row, .review-file-name, .overview-tile-row, .k-row'
/** j/k move through the rows of the focused tile, l opens, h goes back. Never while typing. */
export function listKeys(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey || !['j', 'k', 'h', 'l'].includes(event.key)) return
  const target = event.target as HTMLElement | null
  if (!target || target.closest('input, textarea, select, [contenteditable="true"]')) return
  const tile = target.closest<HTMLElement>('[data-tile-id]') || document.querySelector<HTMLElement>('.resource-tile.tile-focused')
  if (!tile) return
  // Lists that handle arrows themselves (Files, Front) get arrows.
  const own = target.closest<HTMLElement>('[data-arrow-keys]')
  if (own) {
    event.preventDefault()
    const key = { j: 'ArrowDown', k: 'ArrowUp', l: 'Enter', h: 'Backspace' }[event.key]!
    own.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    return
  }
  const rows = [...tile.querySelectorAll<HTMLElement>(rowSelector)].filter(row => row.getClientRects().length && !(row as HTMLButtonElement).disabled)
  if (!rows.length) return
  event.preventDefault()
  const at = rows.indexOf(target.closest<HTMLElement>(rowSelector) as HTMLElement)
  if (event.key === 'j' || event.key === 'k') rows[at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (event.key === 'j' ? 1 : -1)))].focus()
  if (event.key === 'l' && at >= 0) rows[at].click()
  if (event.key === 'h') tile.querySelector<HTMLElement>('[data-back]')?.click()
}

/** An icon button that shows the key that does the same thing. */
export function KeyButton({ label, keys, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; keys?: string; children: ReactNode }) {
  return <button type="button" className={`key-button ${className}`} aria-label={label} title={keys ? `${label} · ${keys}` : label} {...props}>{children}{keys && <kbd>{keys}</kbd>}</button>
}
