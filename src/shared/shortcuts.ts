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
    if (key === 'n') return 'new-session'
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
    if (key === '.') return 'attach-selection'
    if (key === 'l') return 'address'
    if (key === 't') return input.shift ? 'restore-closed' : 'new-browser'
    if (key === 'w') return 'close-tile'
    if (key === 'tab') return input.shift ? 'previous-tile' : 'next-tile'
    if (key === 'k') return 'launcher'
    if (key === 'b' && input.shift) return 'fullscreen'
  }
}
