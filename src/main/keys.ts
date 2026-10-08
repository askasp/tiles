import { createShortcutReader } from '../shared/shortcuts'

/** One reader for the window and its pages: Ctrl+W in a page, then h, still pairs up. */
export const readShortcut = createShortcutReader()
