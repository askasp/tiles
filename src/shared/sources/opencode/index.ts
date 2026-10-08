import { browserTile, desktopInitial, focusTile, goWorkspace, openTile, shelfTile, type KindRule, type TileDesktop, type TileInput } from '../../tiles'
import type { CatalogueEntry } from '../../catalogue'
import { basename } from '../../util'
import { restoreState, sessionTitle } from './legacy'
import type { SessionInfo } from './types'
export * from './types'
export { sessionTitle, directoryOf } from './legacy'

/** OpenCode as a source: projects, sessions and their changes. Everything here is optional. */
export const opencodeEntry: CatalogueEntry = {
  id: 'opencode', name: 'OpenCode', hint: 'Projects and sessions', prefixes: ['opencode'], hosts: [], builtin: false,
  kinds: {
    projects: { label: 'OpenCode', kind: 'Projects', action: 'Browse projects' },
    project: { label: 'OpenCode project', kind: 'Project', action: 'Show sessions' },
    session: { label: 'OpenCode session', kind: 'Session', action: 'Open conversation' },
    review: { label: 'OpenCode changes', kind: 'Changes', action: 'Review diff' },
    details: { label: 'OpenCode session', kind: 'Session', action: 'Show details' },
  },
}
export const sessionTile = (s: SessionInfo): TileInput => ({ id: s.id, key: `session:${s.id}`, kind: 'session', title: sessionTitle(s), sessionID: s.id, directory: s.location.directory || '' })
export const projectTile = (directory: string, title = basename(directory)): TileInput => ({ key: `project:${directory}`, kind: 'project', title, directory })
export const projectsTile = (): TileInput => ({ key: 'opencode:projects', kind: 'projects', title: 'OpenCode projects' })
export const reviewTile = (directory: string): TileInput => ({ key: `review:${directory}`, kind: 'review', title: `Review changes · ${basename(directory)}`, directory })

export const opencodeKinds: KindRule[] = [
  { kind: 'projects', restore: t => { t.key = 'opencode:projects'; return true } },
  { kind: 'session', restore: t => { if (typeof t.sessionID !== 'string' || !t.sessionID) return false; t.key = `session:${t.sessionID}`; return true } },
  { kind: 'project', restore: t => { if (typeof t.directory !== 'string' || !t.directory) return false; t.key = `project:${t.directory}`; return true } },
  { kind: 'review', restore: t => { if (typeof t.directory !== 'string' || !t.directory) return false; t.key = `review:${t.directory}`; return true } },
  { kind: 'details', restore: t => { if (typeof t.sessionID !== 'string' || !t.sessionID) return false; t.key = `details:${t.sessionID}`; return true } },
]

/** “start (an opencode) session in chatos: first message” → project + first message. Nothing runs from parsing. */
export function sessionIntent(value: string): { project: string; message: string } | undefined {
  const match = value.trim().match(/^(?:opencode\s+)?(?:start|new|create)(?: an?)? (?:opencode )?session(?: in| for)?\s*(.*)$/i)
  if (!match) return undefined
  const i = match[1].indexOf(':')
  return i < 0 ? { project: match[1].trim(), message: '' } : { project: match[1].slice(0, i).trim(), message: match[1].slice(i + 1).trim() }
}
/** “open the chatos sessions (in opencode)” → a project's session list. */
export const sessionsIntent = (value: string) => value.trim().match(/^(?:open|show)(?: the)? (.+?) sessions(?: in opencode)?\.?$/i)?.[1]

/** v1 desktops were OpenCode workspaces: one per session, with stage tabs. */
export function migrateV1(raw: string, directory: string): TileDesktop | undefined {
  let parsed: { version?: unknown }
  try { parsed = JSON.parse(raw) } catch { return undefined }
  if (parsed?.version !== 1) return undefined
  const old = restoreState(raw, directory)
  let s: TileDesktop = { ...desktopInitial(old.selectedDirectory), folders: old.folders, pinned: old.pinned, homeDraft: old.homeDraft }
  for (const w of old.workspaces) {
    const slot = old.workspaces.indexOf(w) + 1
    s = goWorkspace(s, slot)
    const target = s.activeID
    if (w.sessionID) s = openTile(s, { id: w.sessionID, key: `session:${w.sessionID}`, kind: 'session', title: w.title, sessionID: w.sessionID, directory: w.directory, draft: w.draft, context: w.context })
    for (const tab of w.tabs) {
      s = { ...s, activeID: target }
      const input = tab.kind === 'browser' ? { ...browserTile(tab.url, w.sessionID), id: tab.id, title: tab.title } : { key: `${tab.kind}:${tab.kind === 'review' ? w.directory : w.sessionID}`, kind: tab.kind, title: tab.title, directory: w.directory, sessionID: w.sessionID, linkID: tab.kind === 'details' ? w.sessionID : undefined }
      if (!s.tiles.some(t => t.key === input.key)) s = openTile(s, input, 'here', target)
    }
    if (w.hidden) for (const t of s.tiles.filter(t => t.workspaceID === target)) s = shelfTile(s, t.id)
  }
  const oldActive = old.workspaces.find(w => w.id === old.activeID)
  const focused = s.tiles.find(t => t.sessionID === oldActive?.sessionID && t.kind === 'session')
  return { ...(focused?.workspaceID ? focusTile(s, focused.id) : goWorkspace(s, 0)), history: [] }
}
