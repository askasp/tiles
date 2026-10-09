import type { Input } from 'electron'

// One pattern, every action with one home (other keys for it are documented aliases):
// - Leader: ␣ in a tile, or ⌘. / Super+. / Ctrl+Alt+. from anywhere (typing, terminals, pages).
//   App-wide actions live under it in mnemonic groups: g go, n new, w tiles, t this tile.
// - Tiles: Ctrl+W, then one key (also ␣ w): where tiles are.
// - In a tile: bare keys, never while typing: vim motions and the tile's own letters.
// - Accelerators for the top few only: ⌘K, ⌘1–9, ⌘, (Ctrl+Alt instead of ⌘ on Linux, where
//   Super belongs to the window manager).
// Never bound, because the OS takes them: ⌘/Super+Tab and +Space, ⌘H (hide), Super+L (lock),
// Super+arrows (window snapping), ⌘⇧3/4/5 (screenshots), ⌘F/⌘−/⌘= (find, zoom),
// Ctrl+Alt+T and Ctrl+Alt+arrows (Ubuntu terminal, workspace switching).
export function shortcutFor(input: Input): string | undefined {
  if (input.type !== 'keyDown') return
  const key = input.key.toLowerCase()
  const system = input.meta || (input.control && input.alt)
  if (system && !input.shift) {
    if (/^[0-9]$/.test(key)) return `workspace:${key}`
    if (key === 'k') return 'launcher'
    if (key === '.') return 'actions'
    if (key === ',') return 'settings'
    if (key === '/') return 'keys'
    // ⌘[ / ⌘]: back and forward in this tile (a list ↔ what you opened from it).
    if (key === '[') return 'tile-back'
    if (key === ']') return 'tile-forward'
  }
  if (input.control && !input.alt && !input.meta && !input.shift) {
    if (key === 'k') return 'launcher'
    if (key === 'l') return 'address'
    if (key === '.') return 'attach-selection'
    // Vim's jump list: Ctrl+O back, Ctrl+I forward, in the focused tile.
    if (key === 'o') return 'tile-back'
    if (key === 'i') return 'tile-forward'
  }
  if ((input.alt && !input.control && !input.meta && key === 'd') || (key === 'f6' && !input.control && !input.alt && !input.meta)) return 'address'
  if (key === 'f2' && !input.control && !input.alt && !input.meta) return 'rename'
}

/** Plain Ctrl keys a web page keeps (Slack, GitHub and Docs use them). ⌘K / Ctrl+Alt+K still open K. */
export function pageKeepsKey(input: Input) {
  return input.type === 'keyDown' && input.control && !input.alt && !input.meta && ['k', 'i', 'o', 'tab'].includes(input.key.toLowerCase())
}

/** Vim's window keys: Ctrl+W, then a key (also ␣ w, then the key). */
export const windowChord: Record<string, string> = {
  h: 'focus:left', j: 'focus:down', k: 'focus:up', l: 'focus:right',
  H: 'swap:left', J: 'swap:down', K: 'swap:up', L: 'swap:right',
  arrowleft: 'focus:left', arrowdown: 'focus:down', arrowup: 'focus:up', arrowright: 'focus:right',
  w: 'next-tile', W: 'previous-tile', p: 'previous-tile',
  q: 'close-tile', c: 'close-tile', o: 'fullscreen', '-': 'shelf-tile', '=': 'restore-tile', '+': 'restore-tile', x: 'promote',
  // Ctrl+W, then a digit: move the tile to that workspace.
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [String(n), `move-workspace:${n}`])),
}

/** A key in the leader menu: an action, a group of keys, or the focused tile's own letters. */
export interface LeaderEntry { label: string; action?: string; keys?: Record<string, LeaderEntry>; tile?: true }
const entries = (pairs: [string, string, string][]) => Object.fromEntries(pairs.map(([key, label, action]) => [key, { label, action }]))
const digits = (label: (n: number) => string, action: (n: number) => string) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): [string, string, string] => [String(n), label(n), action(n)])
/** ␣ / ⌘.: the which-key menu. The menu, the key sheet and the tests all read this. */
export const leader: Record<string, LeaderEntry> = {
  g: { label: 'Go', keys: entries([
    ...digits(n => `Workspace ${n}`, n => `workspace:${n}`),
    ['0', 'Home', 'workspace:0'], ['o', 'Overview of workspaces and the shelf', 'overview'], ['u', 'What is waiting on you', 'attention'],
  ]) },
  n: { label: 'New', keys: entries([
    ['t', 'Terminal in the focused folder', 'new-terminal'], ['b', 'Browser tile', 'new-browser'],
    ['n', 'New item like this tile', 'new'], ['r', 'Reopen the last closed tile', 'restore-closed'],
  ]) },
  w: { label: 'Tiles (same as Ctrl+W)', keys: entries([
    ['h', 'Focus left', 'focus:left'], ['j', 'Focus down', 'focus:down'], ['k', 'Focus up', 'focus:up'], ['l', 'Focus right', 'focus:right'],
    ['H', 'Swap left', 'swap:left'], ['J', 'Swap down', 'swap:down'], ['K', 'Swap up', 'swap:up'], ['L', 'Swap right', 'swap:right'],
    ['w', 'Next tile', 'next-tile'], ['W', 'Previous tile', 'previous-tile'],
    ['o', 'Fullscreen', 'fullscreen'], ['x', 'Make it the main tile', 'promote'],
    ['-', 'Shelf (stays live)', 'shelf-tile'], ['=', 'Bring back the last shelved', 'restore-tile'], ['q', 'Close for good', 'close-tile'],
    ...digits(n => `Move to workspace ${n}`, n => `move-workspace:${n}`),
  ]) },
  t: { label: 'This tile', tile: true },
  s: { label: 'Settings', action: 'settings' },
  z: { label: 'Undo what K just arranged', action: 'undo-arrangement' },
  '?': { label: 'Every key', action: 'keys' },
}

/** Reads keys including the Ctrl+W chord. One reader per window, shared with its pages,
 * so Ctrl+W pressed in a web page and h pressed after still pair up. */
export function createShortcutReader(now = () => Date.now()) {
  let pendingUntil = 0
  return (input: Input): { action?: string; swallow: boolean } => {
    if (input.type !== 'keyDown') return { swallow: false }
    if (pendingUntil > now()) {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(input.key)) return { swallow: false }
      pendingUntil = 0
      if (input.key === 'Escape') return { action: 'chord-cancel', swallow: true }
      // Ctrl+W Ctrl+H works too, like vim.
      const key = input.key.length === 1 && !input.control ? input.key : input.key.toLowerCase()
      const action = !input.alt && !input.meta ? windowChord[key] : undefined
      if (action) return { action, swallow: true }
      const other = shortcutFor(input)
      return { action: other || 'chord-cancel', swallow: !!other }
    }
    if (input.control && !input.alt && !input.meta && !input.shift && input.key.toLowerCase() === 'w') {
      pendingUntil = now() + 1500
      return { action: 'chord', swallow: true }
    }
    const action = shortcutFor(input)
    return { action, swallow: !!action }
  }
}

/** What the key sheet, Settings and the Ctrl+W hint show. `actions` ties a row to shortcutFor/windowChord/leader (checked by tests). */
export interface KeyHelp { keys: string; label: string; actions?: string[] }
export interface KeyGroup { title: string; rows: KeyHelp[]; /** The Ctrl+W group, shown while the chord waits. */ chord?: boolean }
/** `system` is ⌘ on macOS, Super elsewhere (Ctrl+Alt also works on Linux). */
export function keyHelp(system: string): KeyGroup[] {
  const S = system, mac = system === '⌘', A = mac ? '⌘' : 'Ctrl+Alt+'
  const leaderRows = Object.entries(leader).map(([key, entry]): KeyHelp => entry.keys
    ? { keys: `␣ ${key}`, label: `${entry.label}: ${Object.entries(entry.keys).filter(([k]) => !/^[2-9]$/.test(k)).map(([k, e]) => k === '1' ? `1–9 ${e.label.replace(/ 1$/, '').toLowerCase()}` : `${k} ${e.label.toLowerCase()}`).join(' · ')}`, actions: Object.values(entry.keys).map(e => e.action!) }
    : { keys: `␣ ${key}`, label: entry.tile ? 'This tile’s own actions, with their letters' : entry.label, ...(entry.action && { actions: [entry.action] }) })
  return [
    { title: `Leader · ␣ in a tile, or ${S}+. anywhere`, rows: leaderRows },
    { title: 'Tiles · Ctrl+W, then (vim)', chord: true, rows: [
      { keys: 'h j k l · arrows', label: 'Focus the neighbour', actions: ['focus'] },
      { keys: 'H J K L', label: 'Swap with the neighbour', actions: ['swap'] },
      { keys: '1–9', label: 'Move the tile to that workspace', actions: ['move-workspace'] },
      { keys: 'w · W p', label: 'Next · previous tile', actions: ['next-tile', 'previous-tile'] },
      { keys: 'o · x', label: 'Fullscreen · make main', actions: ['fullscreen', 'promote'] },
      { keys: '− · = +', label: 'Shelf · bring back', actions: ['shelf-tile', 'restore-tile'] },
      { keys: 'q c', label: 'Close for good', actions: ['close-tile'] },
    ] },
    { title: 'In the focused tile (never while typing)', rows: [
      { keys: 'j k · l · h', label: 'Down · up · open · back' },
      { keys: '/', label: 'Filter; Esc or ↓ goes back to the list' },
      { keys: 'a letter', label: 'The tile’s own actions (␣ t lists them)' },
      { keys: `Ctrl+O · Ctrl+I · ${S}+[ ${S}+]`, label: 'Back · forward in the tile (a list ↔ what you opened from it)', actions: ['tile-back', 'tile-forward'] },
      { keys: 'F2', label: 'Rename', actions: ['rename'] },
      { keys: 'D · Delete · ⌘⌫', label: 'Delete the session, or move the file to the Trash (always asks)' },
      { keys: 'X', label: 'Hide the project from ChatOS (Settings shows it again)' },
      { keys: 'Esc', label: 'Leave a text field, so letters are keys again' },
    ] },
    { title: `Accelerators · ${mac ? '⌘' : 'Super, or Ctrl+Alt'}`, rows: [
      { keys: `${S}+K · Ctrl+K`, label: 'K: search, open, ask, or add a source', actions: ['launcher'] },
      { keys: `${A}1–9 · ${A}0`, label: 'Workspace by number · home', actions: ['workspace'] },
      { keys: `${S}+,`, label: 'Settings', actions: ['settings'] },
      { keys: `${S}+. · ${S}+/`, label: 'Leader · every key', actions: ['actions', 'keys'] },
      { keys: 'Ctrl+L · Alt+D · F6', label: 'Address: the page’s address bar, or open a URL', actions: ['address'] },
      { keys: 'Ctrl+.', label: 'Selection as context to another tile (never sends)', actions: ['attach-selection'] },
    ] },
    { title: 'In a web page', rows: [
      { keys: 'Alt+← · Alt+→', label: 'Back · forward in the page' },
      { keys: 'Ctrl+R · F5', label: 'Reload' },
      { keys: 'Ctrl+K · Ctrl+I · Ctrl+O · Ctrl+Tab', label: 'Left to the page' },
      { keys: `${S}+. t`, label: 'The page’s actions: attach, screenshot, devtools…' },
    ] },
    { title: 'In K', rows: [
      { keys: '↑↓ · Ctrl+J K · Ctrl+N P', label: 'Choose a result' },
      { keys: '↵ · Ctrl+↵ · Shift+↵', label: 'Open here · in a new workspace · move here' },
      { keys: '→ · ←', label: 'Other actions on a result · back' },
      { keys: 'Tab · ⌫', label: 'Narrow to a source · widen again' },
      { keys: 'Alt+↵', label: 'Ask K to find it with the model' },
      { keys: 'Esc', label: 'Close' },
    ] },
  ]
}
