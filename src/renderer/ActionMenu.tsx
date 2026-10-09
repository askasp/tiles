import { Keyboard, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { leader, type KeyGroup } from '../shared/shortcuts'
import type { TileAction } from './actions'
import { IconButton, Modal } from './ui'

/** A row in the leader menu: a group to open, or something to run. */
interface Row { key?: string; keys?: string; label: string; group?: string; disabled?: boolean; urgent?: boolean; run?(): void }

/** ␣ / Super+.: which-key. A letter opens its group or runs it; ⌫ goes up; ↑↓ ↵ work too. Stays open until a key or Esc. */
export function LeaderMenu({ start = [], tileTitle, own, generic, run, close }: {
  start?: string[]; tileTitle?: string; own: TileAction[]; generic: TileAction[]; run: (action: string) => void; close: () => void
}) {
  const [path, setPath] = useState(start)
  const list = useRef<HTMLDivElement>(null)
  const level = path[0]
  const fromTile = (a: TileAction): Row => ({ key: a.key, keys: [a.key, a.keyLabel].filter(Boolean).join(' · '), label: a.label, disabled: a.disabled, urgent: a.urgent, run: () => { close(); void a.run() } })
  const rows: Row[] = level === 't' ? [...own.map(fromTile), ...generic.map(fromTile)]
    : level ? Object.entries(leader[level].keys!).map(([key, entry]) => ({ key, label: entry.label, run: () => { close(); run(entry.action!) } }))
    : [...own.filter(a => a.urgent && a.key && !leader[a.key]).map(fromTile),
      ...Object.entries(leader).map(([key, entry]): Row => entry.keys || entry.tile
        ? { key, label: entry.tile ? `This tile${tileTitle ? ` · ${tileTitle}` : ''}` : entry.label, group: key, disabled: entry.tile && !tileTitle }
        : { key, label: entry.label, run: () => { close(); run(entry.action!) } })]
  // Workspace digits read as one row: 1–9.
  const shown = rows.filter(r => !/^[2-9]$/.test(r.key || '') || !rows.some(o => o.key === '1' && !o.urgent)).map(r => r.key === '1' && level && level !== 't' ? { ...r, keys: '1–9', label: r.label.replace(/ 1$/, ' 1–9') } : r)
  useEffect(() => { list.current?.querySelector<HTMLButtonElement>('.action-row:not(:disabled)')?.focus() }, [path])
  const choose = (row: Row) => { if (row.disabled) return; if (row.group) setPath([row.group]); else row.run?.() }
  const keys = (event: ReactKeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    // Handled here: never let the key reach the tile underneath once the menu closes.
    if (event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); if (path.length) setPath([]); else close(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation()
      const buttons = [...list.current?.querySelectorAll<HTMLButtonElement>('.action-row:not(:disabled)') || []], at = buttons.indexOf(event.target as HTMLButtonElement)
      buttons[Math.max(0, Math.min(buttons.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
      return
    }
    if (event.key.length !== 1 || event.key === ' ') return
    const row = rows.find(r => r.key === event.key && !r.disabled)
    if (row) { event.preventDefault(); event.stopPropagation(); choose(row) }
  }
  const title = level === 't' ? `This tile${tileTitle ? ` · ${tileTitle}` : ''}` : level ? leader[level].label : 'Leader'
  return <Modal title={`Actions · ${level === 't' ? tileTitle || 'tile' : title}`} close={close}><div className="action-menu" onKeyDown={keys}>
    <div className="modal-heading"><h2 className="truncate"><kbd>␣{path.map(p => ` ${p}`).join('')}</kbd> {title}</h2><span className="muted">{path.length ? '⌫ back · ' : ''}Esc closes</span><IconButton label="Close actions" onClick={close}><X size={16} /></IconButton></div>
    <div className="action-list" ref={list}>
      {shown.map((row, index) => <button type="button" key={`${row.key || ''}-${row.label}-${index}`} className={`action-row ${row.urgent ? 'urgent' : ''} ${row.group ? 'group' : ''}`} disabled={row.disabled} onClick={() => choose(row)}>
        <kbd aria-hidden>{row.keys ?? row.key ?? ''}</kbd><span className="truncate">{row.label}{row.group ? '…' : ''}</span>
      </button>)}
      {!shown.length && <p className="empty-list">Nothing here.</p>}
    </div>
  </div></Modal>
}

/** ? / Super+/: every key, from the same table the shortcuts use, plus the focused tile's own. */
export function KeySheet({ groups, tileTitle, own, close }: { groups: KeyGroup[]; tileTitle?: string; own: TileAction[]; close: () => void }) {
  const tileRows = own.filter(a => a.key || a.keyLabel).map(a => ({ keys: [a.key, a.keyLabel].filter(Boolean).join(' · '), label: a.label }))
  const all = [...(tileTitle && tileRows.length ? [{ title: `This tile · ${tileTitle}`, rows: tileRows }] : []), ...groups]
  return <Modal title="Keys" close={close} wide><div className="key-sheet">
    <div className="modal-heading"><Keyboard size={17} /><h2>Keys</h2><span className="muted">Esc closes</span><IconButton label="Close keys" onClick={close}><X size={16} /></IconButton></div>
    <div className="key-sheet-groups">{all.map(group => <section key={group.title} aria-label={group.title}><h3>{group.title}</h3>
      {group.rows.map(row => <div className="shortcut-row" key={row.keys + row.label}><kbd>{row.keys}</kbd><span>{row.label}</span></div>)}
    </section>)}</div>
  </div></Modal>
}
