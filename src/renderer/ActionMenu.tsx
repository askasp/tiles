import { Keyboard, X } from 'lucide-react'
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { KeyGroup } from '../shared/shortcuts'
import type { TileAction } from './actions'
import { IconButton, Modal } from './ui'

const rowsIn = (root: HTMLElement | null) => [...root?.querySelectorAll<HTMLButtonElement>('.action-row:not(:disabled)') || []]

/** Space / Super+.: every action of the focused tile, each with its key. A letter runs it, digits move the tile. */
export function ActionMenu({ title, own, tile, move, close }: { title: string; own: TileAction[]; tile: TileAction[]; move: (slot: number) => void; close: () => void }) {
  const [filter, setFilter] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  // The tile's own letters win; a generic action keeps its letter only when the tile doesn't use it.
  const taken = new Set(own.map(a => a.key).filter(Boolean))
  const generic = tile.map(a => a.key && taken.has(a.key) ? { ...a, key: undefined } : a)
  const match = (a: TileAction) => !filter || a.label.toLowerCase().includes(filter.toLowerCase())
  const groups = [{ title, actions: own.filter(match) }, { title: 'Tile', actions: generic.filter(match) }].filter(g => g.actions.length)
  const run = (action: TileAction) => { if (action.disabled) return; close(); void action.run() }
  const keys = (event: ReactKeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT') {
      if (event.key === 'Escape' && filter) { event.preventDefault(); event.stopPropagation(); setFilter(null) }
      if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); const first = rowsIn(list.current)[0]; if (event.key === 'Enter') first?.click(); else first?.focus() }
      return
    }
    const rows = rowsIn(list.current), at = rows.indexOf(target as HTMLButtonElement)
    if (event.key === '/') { event.preventDefault(); setFilter(''); return }
    if (event.key === 'j' || event.key === 'ArrowDown' || event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault()
      const down = event.key === 'j' || event.key === 'ArrowDown'
      rows[Math.max(0, Math.min(rows.length - 1, at + (down ? 1 : -1)))]?.focus()
      return
    }
    if (/^[1-9]$/.test(event.key)) { event.preventDefault(); close(); move(Number(event.key)); return }
    if (event.key.length !== 1 || event.key === ' ') return
    const action = [...own, ...generic].find(a => a.key === event.key && !a.disabled)
    if (action) { event.preventDefault(); run(action) }
  }
  return <Modal title={`Actions · ${title}`} close={close}><div className="action-menu" onKeyDown={keys}>
    <div className="modal-heading"><h2 className="truncate">{title}</h2><span className="muted">a key runs it · 1–9 moves the tile · / filter</span><IconButton label="Close actions" onClick={close}><X size={16} /></IconButton></div>
    {filter !== null && <input className="large-input" autoFocus aria-label="Filter actions" placeholder="Filter actions…" value={filter} onChange={e => setFilter(e.target.value)} />}
    <div className="action-list" ref={list}>
      {groups.map(group => <section key={group.title} aria-label={group.title}><span className="k-head">{group.title}</span>
        {group.actions.map(action => <button type="button" key={action.id} className={`action-row ${action.urgent ? 'urgent' : ''}`} disabled={action.disabled} onClick={() => run(action)}>
          <span className="truncate">{action.label}</span><kbd>{action.key || action.keyLabel || ''}</kbd>
        </button>)}
      </section>)}
      {!groups.length && <p className="empty-list">No action matches “{filter}”.</p>}
    </div>
  </div></Modal>
}

/** ? / Super+/: every key, from the same table the shortcuts use, plus the focused tile's own. */
export function KeySheet({ groups, tileTitle, own, close }: { groups: KeyGroup[]; tileTitle?: string; own: TileAction[]; close: () => void }) {
  const tileRows = own.filter(a => a.key || a.keyLabel).map(a => ({ keys: a.key || a.keyLabel!, label: a.label }))
  const all = [...(tileTitle && tileRows.length ? [{ title: `This tile · ${tileTitle}`, rows: tileRows }] : []), ...groups]
  return <Modal title="Keys" close={close} wide><div className="key-sheet">
    <div className="modal-heading"><Keyboard size={17} /><h2>Keys</h2><span className="muted">Esc closes</span><IconButton label="Close keys" onClick={close}><X size={16} /></IconButton></div>
    <div className="key-sheet-groups">{all.map(group => <section key={group.title} aria-label={group.title}><h3>{group.title}</h3>
      {group.rows.map(row => <div className="shortcut-row" key={row.keys + row.label}><kbd>{row.keys}</kbd><span>{row.label}</span></div>)}
    </section>)}</div>
  </div></Modal>
}
