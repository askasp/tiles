import type { Input } from 'electron'

export function shortcutFor(input: Input): string | undefined {
  if (input.type !== 'keyDown') return
  const key = input.key.toLowerCase()
  // Super/Cmd follows the design. Ctrl+Alt is an app-local alternative for
  // Linux window managers that reserve Super for their own workspaces.
  const system = input.meta || (input.control && input.alt)
  if (system) {
    // Shift+2 can report “@”, depending on the keyboard layout/platform.
    // Numbered workspace controls refer to the physical number row.
    const digit = input.code?.match(/^Digit([0-9])$/)?.[1]
    if (digit) return `${input.shift ? 'move-workspace' : 'workspace'}:${digit}`
    if (/^[0-9]$/.test(key)) return `${input.shift ? 'move-workspace' : 'workspace'}:${key}`
    if (key === 'tab') return 'overview'
    if ((key === 'k' && !input.shift) || key === ' ' || key === 'space') return 'launcher'
    // Cmd+[ / Cmd+]: back and forward in this tile (a list ↔ what you opened from it).
    if (key === '[' || input.code === 'BracketLeft') return 'tile-back'
    if (key === ']' || input.code === 'BracketRight') return 'tile-forward'
    if (key === 'n') return 'new'
    if (key === 't') return 'new-terminal'
    if (key === ',') return 'settings'
    // Cmd+W / Super+W / Ctrl+Alt+W closes a tile, like a tab. (Cmd+Shift+Q belongs to macOS.)
    if (key === 'w' && !input.shift) return 'close-tile'
    if (key === 'f') return 'fullscreen'
    if (key === '-' || key === 'subtract') return 'shelf-tile'
    if (key === '=' || key === '+' || key === 'add') return 'restore-tile'
    if (key === 'u') return 'attention'
    if (key === '.') return 'actions'
    if (key === '/' || input.code === 'Slash') return 'keys'
    if (key === 'z') return 'undo-arrangement'
    const directions: Record<string, string> = { arrowleft: 'left', h: 'left', arrowright: 'right', l: 'right', arrowup: 'up', k: 'up', arrowdown: 'down', j: 'down' }
    // Super+K is reserved for the launcher; use the up arrow for upward focus.
    if (directions[key]) return `${input.shift ? 'swap' : 'focus'}:${directions[key]}`
  }
  if (input.control && !input.alt && !input.meta) {
    if (key === 'k' || key === ' ' || key === 'space') return 'launcher'
    if (key === 'l') return 'address'
    if (key === '.') return 'attach-selection'
    if (key === 't') return input.shift ? 'restore-closed' : 'new-browser'
    if (key === 'tab') return input.shift ? 'previous-tile' : 'next-tile'
    if (key === 'b' && input.shift) return 'fullscreen'
    // Vim's jump list: Ctrl+O back, Ctrl+I forward, in the focused tile.
    if (key === 'o' && !input.shift) return 'tile-back'
    if (key === 'i' && !input.shift) return 'tile-forward'
  }
  if ((input.alt && !input.control && !input.meta && key === 'd') || (key === 'f6' && !input.control && !input.alt && !input.meta)) return 'address'
  if (key === 'f2' && !input.control && !input.alt && !input.meta) return 'rename'
}

/** Vim's window keys: Ctrl+W, then a key. */
export const windowChord: Record<string, string> = {
  h: 'focus:left', j: 'focus:down', k: 'focus:up', l: 'focus:right',
  H: 'swap:left', J: 'swap:down', K: 'swap:up', L: 'swap:right',
  arrowleft: 'focus:left', arrowdown: 'focus:down', arrowup: 'focus:up', arrowright: 'focus:right',
  w: 'next-tile', W: 'previous-tile', p: 'previous-tile',
  q: 'close-tile', c: 'close-tile', o: 'fullscreen', '-': 'shelf-tile', '=': 'restore-tile', '+': 'restore-tile', x: 'promote',
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

/** What the key sheet, Settings and the Ctrl+W hint show. `action` ties a row to shortcutFor/windowChord (checked by tests). */
export interface KeyHelp { keys: string; label: string; actions?: string[] }
export interface KeyGroup { title: string; rows: KeyHelp[] }
/** `system` is ⌘ on macOS, Super elsewhere (Ctrl+Alt also works on Linux). */
export function keyHelp(system: string): KeyGroup[] {
  const S = system
  return [
    { title: 'Anywhere', rows: [
      { keys: `${S}+K · Ctrl+K · ${S}+Space`, label: 'K: search, open, ask, or add a source', actions: ['launcher'] },
      { keys: `${S}+. · ␣ in a tile`, label: 'Actions for the focused tile', actions: ['actions'] },
      { keys: `${S}+/ · ?`, label: 'This key sheet', actions: ['keys'] },
      { keys: `${S}+1–9 · ${S}+0`, label: 'Workspace by number · home', actions: ['workspace'] },
      { keys: `${S}+Tab`, label: 'Overview of workspaces and the shelf', actions: ['overview'] },
      { keys: `${S}+U`, label: 'Go to what is waiting on you', actions: ['attention'] },
      { keys: `${S}+T · ${S}+N`, label: 'Terminal in the focused folder · new item like the focused tile', actions: ['new-terminal', 'new'] },
      { keys: 'Ctrl+T · Ctrl+Shift+T', label: 'New browser tile · reopen the last closed tile', actions: ['new-browser', 'restore-closed'] },
      { keys: 'Ctrl+L · Alt+D · F6', label: 'Address: the page’s address bar, or open a URL', actions: ['address'] },
      { keys: 'Ctrl+.', label: 'Selection as context to another tile (never sends)', actions: ['attach-selection'] },
      { keys: `${S}+Z`, label: 'Undo what K just arranged', actions: ['undo-arrangement'] },
      { keys: `${S}+,`, label: 'Settings', actions: ['settings'] },
    ] },
    { title: 'Tiles', rows: [
      { keys: `${S}+H J K L · ${S}+arrows`, label: 'Focus the neighbour (Super+K is K: use ↑)', actions: ['focus'] },
      { keys: `${S}+Shift+H J K L`, label: 'Swap with the neighbour', actions: ['swap'] },
      { keys: 'Ctrl+Tab · Ctrl+Shift+Tab', label: 'Next · previous tile', actions: ['next-tile', 'previous-tile'] },
      { keys: `${S}+Shift+1–9`, label: 'Move the tile to a workspace', actions: ['move-workspace'] },
      { keys: `Ctrl+O · Ctrl+I · ${S}+[ ${S}+]`, label: 'Back · forward in the tile (a list ↔ what you opened from it)', actions: ['tile-back', 'tile-forward'] },
      { keys: `${S}+F · Ctrl+Shift+B`, label: 'Fullscreen', actions: ['fullscreen'] },
      { keys: `${S}+− · ${S}+=`, label: 'Shelf · bring back the last shelved', actions: ['shelf-tile', 'restore-tile'] },
      { keys: `${S}+W`, label: 'Close for good', actions: ['close-tile'] },
      { keys: 'F2', label: 'Rename', actions: ['rename'] },
    ] },
    { title: 'Ctrl+W, then (vim)', rows: [
      { keys: 'h j k l · arrows', label: 'Focus the neighbour', actions: ['focus'] },
      { keys: 'H J K L', label: 'Swap with the neighbour', actions: ['swap'] },
      { keys: 'w · W p', label: 'Next · previous tile', actions: ['next-tile', 'previous-tile'] },
      { keys: 'o · x', label: 'Fullscreen · make main', actions: ['fullscreen', 'promote'] },
      { keys: '− · = +', label: 'Shelf · bring back', actions: ['shelf-tile', 'restore-tile'] },
      { keys: 'q c', label: 'Close for good', actions: ['close-tile'] },
    ] },
    { title: 'In the focused tile', rows: [
      { keys: '␣', label: 'Action menu: every button, with its key' },
      { keys: 'j k · l · h', label: 'Down · up · open · back' },
      { keys: '/', label: 'Filter; Esc or ↓ goes back to the list' },
      { keys: 'a letter', label: 'The tile’s own actions (see ␣)' },
    ] },
    { title: 'In a web page', rows: [
      { keys: 'Alt+← · Alt+→', label: 'Back · forward in the page' },
      { keys: 'Ctrl+R · F5', label: 'Reload' },
      { keys: `${S}+.`, label: 'The page’s actions: attach, screenshot, devtools…' },
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
