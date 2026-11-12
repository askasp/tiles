import type { Input } from 'electron'

// One pattern, every action with one home (other keys for it are documented aliases):
// - Leader: ␣ in a tile, or ⌘. / Super+. / Ctrl+Alt+. from anywhere (typing, terminals, pages).
//   App-wide actions live under it in mnemonic groups: g go, n new, w tiles, t this tile.
// - Tiles: Ctrl+W, then one key (also ␣ w): where tiles are. In a terminal too, like a tmux prefix:
//   Ctrl+W ; sends the shell (or nvim) its own Ctrl+W.
// - In a tile: bare keys, never while typing: vim motions and the tile's own letters.
// - Accelerators for the top few only: ⌘K, ⌘1–9, ⌘, (Ctrl+Alt instead of ⌘ on Linux, where
//   Super belongs to the window manager).
// - Workspaces like i3 (whose default mod is Alt): Alt+1–9 goes there, Alt+Shift+1–9 sends the
//   focused tile there. Not on a Mac, where Option+digit types characters: ⌘1–9 goes, ⌘⌃1–9 sends
//   (⌘⇧1–9 too, but ⌘⇧3/4/5 stay macOS screenshots).
// Never bound, because the OS takes them: ⌘/Super+Tab and +Space, ⌘H (hide), Super+L (lock),
// Super+arrows (window snapping), ⌘⇧3/4/5 (screenshots), ⌘F/⌘−/⌘= (find, zoom),
// Ctrl+Alt+T and Ctrl+Alt+arrows (Ubuntu terminal, workspace switching).
const mac = typeof process !== 'undefined' && process.platform ? process.platform === 'darwin' : typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
export function shortcutFor(input: Input): string | undefined {
  if (input.type !== 'keyDown') return
  const key = input.key.toLowerCase()
  // Shift turns 1 into “!” on the key, so read the physical key.
  const digit = input.code?.match(/^Digit([0-9])$/)?.[1]
  if (digit && input.alt && !input.control && !input.meta && !mac) return input.shift ? digit === '0' ? undefined : `move-workspace:${digit}` : `workspace:${digit}`
  const system = input.meta || (input.control && input.alt)
  // ⌘⇧1–9 (Ctrl+Alt+Shift on Linux) sends the tile, as ⌘1–9 goes. macOS keeps ⌘⇧3/4/5 for screenshots,
  // so ⌘⌃1–9 sends it too: nothing on a Mac uses those, so all nine work.
  if (digit && system && input.shift) return digit === '0' ? undefined : `move-workspace:${digit}`
  if (digit && input.meta && input.control && !input.alt) return digit === '0' ? undefined : `move-workspace:${digit}`
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

/** Keys that work even in a terminal or a text field: they belong to the desktop, like a window manager's. */
export const desktopKey = (action?: string) => action === 'attach-selection' || /^(move-)?workspace:/.test(action || '')

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
  q: 'hide-tile', c: 'hide-tile', Q: 'end-tile', o: 'fullscreen', '=': 'restore-tile', '+': 'restore-tile', x: 'promote',
  // Ctrl+W is the prefix in a terminal too, so this hands the terminal a real Ctrl+W (delete word, nvim's windows).
  ';': 'terminal-ctrl-w',
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
    ['0', 'Home', 'workspace:0'], ['o', 'Overview of workspaces', 'overview'], ['u', 'What is waiting on you', 'attention'],
  ]) },
  n: { label: 'New', keys: entries([
    ['t', 'Terminal in the focused folder', 'new-terminal'], ['b', 'Browser tile', 'new-browser'],
    ['n', 'New item like this tile', 'new'],
  ]) },
  w: { label: 'Tiles (same as Ctrl+W)', keys: entries([
    ['h', 'Focus left', 'focus:left'], ['j', 'Focus down', 'focus:down'], ['k', 'Focus up', 'focus:up'], ['l', 'Focus right', 'focus:right'],
    ['H', 'Swap left', 'swap:left'], ['J', 'Swap down', 'swap:down'], ['K', 'Swap up', 'swap:up'], ['L', 'Swap right', 'swap:right'],
    ['w', 'Next tile', 'next-tile'], ['W', 'Previous tile', 'previous-tile'],
    ['o', 'Fullscreen', 'fullscreen'], ['x', 'Make it the main tile', 'promote'],
    ['q', 'Hide (K finds it)', 'hide-tile'], ['Q', 'Hide and end (a terminal’s shell)', 'end-tile'], ['=', 'Bring back the last hidden', 'restore-tile'],
    [';', 'Send Ctrl+W to the terminal', 'terminal-ctrl-w'],
    ...digits(n => `Move to workspace ${n}`, n => `move-workspace:${n}`),
  ]) },
  t: { label: 'This tile', tile: true },
  s: { label: 'Settings', action: 'settings' },
  z: { label: 'Undo what K just arranged', action: 'undo-arrangement' },
  '?': { label: 'Every key', action: 'keys' },
}

/** Reads keys including the Ctrl+W chord. One reader per window, shared with its pages,
 * so Ctrl+W pressed in a web page and h pressed after still pair up. */
export const isChordKey = (input: Input) => input.type === 'keyDown' && input.control && !input.alt && !input.meta && !input.shift && input.key.toLowerCase() === 'w'

export function createShortcutReader(now = () => Date.now()) {
  let pendingUntil = 0
  /** True while Ctrl+W waits for its second key: that key is ours, even in a terminal. */
  const pending = () => pendingUntil > now()
  return Object.assign((input: Input): { action?: string; swallow: boolean } => {
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
    if (isChordKey(input)) {
      pendingUntil = now() + 1500
      return { action: 'chord', swallow: true }
    }
    const action = shortcutFor(input)
    return { action, swallow: !!action }
  }, { pending })
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
      { keys: 'q c · = +', label: 'Hide · bring back the last hidden', actions: ['hide-tile', 'restore-tile'] },
      { keys: 'Q', label: 'Hide and end (a terminal’s shell, a page’s memory)', actions: ['end-tile'] },
      { keys: ';', label: 'Send Ctrl+W itself to the terminal (delete word, nvim’s windows)', actions: ['terminal-ctrl-w'] },
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
      { keys: mac ? '⌘1–9 · ⌘0' : 'Alt+1–9 · Alt+0 · Ctrl+Alt+1–9', label: 'Workspace by number · home (i3)', actions: ['workspace'] },
      { keys: mac ? '⌘⌃1–9 · ⌘⇧1–9' : 'Alt+Shift+1–9 · Ctrl+Alt+Shift+1–9', label: mac ? 'Send the focused tile to that workspace (⌘⇧3/4/5 are screenshots)' : 'Send the focused tile to that workspace (i3)', actions: ['move-workspace'] },
      { keys: `${S}+,`, label: 'Settings', actions: ['settings'] },
      { keys: `${S}+. · ${S}+/`, label: 'Leader · every key', actions: ['actions', 'keys'] },
      { keys: 'Ctrl+L · Alt+D · F6', label: 'Open a URL in its own tile (or go to the tile that has it)', actions: ['address'] },
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
      { keys: `↵ · ${mac ? '⌘↵' : 'Ctrl+↵'}`, label: 'Open in its own space (or go to it) · join it to this page' },
      { keys: '→ · ←', label: 'Other actions on a result · back' },
      { keys: 'Tab · ⌫', label: 'Narrow to a source · widen again' },
      { keys: 'Alt+↵', label: 'Ask K to find it with the model' },
      { keys: 'Esc', label: 'Close' },
    ] },
  ]
}
