import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'

/** Something you can do in a tile. Its key works while the tile is focused and in the action menu (Space / Super+.). */
export interface TileAction {
  id: string
  label: string
  /** One character pressed in the tile (never while typing). */
  key?: string
  /** A key handled elsewhere (e.g. “⌫”, “Alt+→”), shown in the menu only. */
  keyLabel?: string
  disabled?: boolean
  /** Shown first, e.g. a permission waiting on you. */
  urgent?: boolean
  run(): void | Promise<void>
}

/** Keys every tile keeps: list movement, filter, help and the menu. */
export const reservedKeys = new Set(['j', 'k', 'h', 'l', '/', '?', ' '])

/** Drops keys that are reserved or already taken in the same tile; returns what was dropped. */
export function validateActions(actions: TileAction[]): { actions: TileAction[]; problems: string[] } {
  const seen = new Set<string>(), problems: string[] = []
  const clean = actions.map(action => {
    if (!action.key) return action
    if (action.key.length !== 1) problems.push(`“${action.label}”: key “${action.key}” must be one character`)
    else if (reservedKeys.has(action.key)) problems.push(`“${action.label}”: key “${action.key}” is reserved`)
    else if (seen.has(action.key)) problems.push(`“${action.label}”: key “${action.key}” is used twice`)
    else { seen.add(action.key); return action }
    return { ...action, key: undefined }
  })
  return { actions: clean, problems }
}

// tile id → owner (a component or source) → actions. Closures are refreshed every render;
// listeners only hear about changes to what is shown.
const store = new Map<string, Map<string, { actions: TileAction[]; signature: string }>>()
const listeners = new Set<() => void>()
let version = 0
const emit = () => { version++; for (const listener of listeners) listener() }
const signatureOf = (actions: TileAction[]) => actions.map(a => `${a.id}:${a.key || ''}:${a.keyLabel || ''}:${a.label}:${a.disabled ? 1 : 0}:${a.urgent ? 1 : 0}`).join('|')

export function setTileActions(tileID: string, owner: string, actions: TileAction[]) {
  const signature = signatureOf(actions)
  const owners = store.get(tileID) || new Map()
  const changed = owners.get(owner)?.signature !== signature
  owners.set(owner, { actions, signature }); store.set(tileID, owners)
  if (changed) emit()
}
export function clearTileActions(tileID: string, owner: string) {
  if (store.get(tileID)?.delete(owner)) emit()
}

/** Register this component's actions for a tile while it is mounted. */
export function useTileActions(tileID: string, owner: string, actions: TileAction[]) {
  useLayoutEffect(() => { setTileActions(tileID, owner, actions) })
  useEffect(() => () => clearTileActions(tileID, owner), [tileID, owner])
}

/** All actions for a tile, urgent first, keys checked. */
export function tileActions(tileID: string): TileAction[] {
  const all = [...(store.get(tileID)?.values() || [])].flatMap(entry => entry.actions)
  const { actions, problems } = validateActions([...all.filter(a => a.urgent), ...all.filter(a => !a.urgent)])
  for (const problem of problems) console.error(`Tile action key: ${problem}`)
  return actions
}
export function actionForKey(tileID: string, key: string) {
  return tileActions(tileID).find(action => action.key === key && !action.disabled)
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
/** Re-renders when any tile's actions change. */
export const useActionsVersion = () => useSyncExternalStore(subscribe, () => version)
