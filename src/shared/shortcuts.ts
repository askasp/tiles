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
    if (key === 'enter') return 'promote'
    if (key === 'n') return 'new'
    if (key === 't') return 'new-terminal'
    if (key === ',') return 'settings'
    if (key === 'q' && input.shift) return 'close-tile'
    if (key === 'f') return 'fullscreen'
    if (key === '-' || key === 'subtract') return 'shelf-tile'
    if (key === '=' || key === '+' || key === 'add') return 'restore-tile'
    if (key === 'u') return 'attention'
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
