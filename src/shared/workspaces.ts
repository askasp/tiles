import type { SessionInfo, StageTab, Workspace, WorkspaceState } from './types'

export const HOME = 'home'
export const uid = () => crypto.randomUUID()
export const basename = (path: string) => path.replace(/\/$/, '').split('/').pop() || path
export const sessionTitle = (session: SessionInfo) => session.title || 'New session'
export const directoryOf = (session: SessionInfo) => session.location.directory || ''

export function initialState(directory = ''): WorkspaceState {
  return { version: 1, activeID: HOME, workspaces: [], folders: [], selectedDirectory: directory, pinned: [], homeDraft: '' }
}

function emptyWorkspace(id: string, kind: Workspace['kind'], title: string): Workspace {
  return {
    id, kind, title, hidden: false, tabs: [], panes: [null, null], tabPane: {},
    split: false, focusedPane: 0, fullscreen: false, draft: '', context: [], closedTabs: [],
  }
}

export function sessionWorkspace(session: SessionInfo): Workspace {
  return {
    ...emptyWorkspace(session.id, 'session', sessionTitle(session)),
    sessionID: session.id, directory: directoryOf(session),
  }
}

export function webWorkspace(url: string): Workspace {
  const workspace = emptyWorkspace(uid(), 'web', new URL(url).hostname || 'Browser')
  return addTab(workspace, { id: uid(), kind: 'browser', title: workspace.title, url })
}

export function openSession(state: WorkspaceState, session: SessionInfo): WorkspaceState {
  const existing = state.workspaces.find(w => w.sessionID === session.id)
  const workspace = existing
    ? { ...existing, hidden: false, title: sessionTitle(session), directory: directoryOf(session) }
    : sessionWorkspace(session)
  return {
    ...state, activeID: workspace.id,
    workspaces: existing ? state.workspaces.map(w => w.id === workspace.id ? workspace : w) : [...state.workspaces, workspace],
  }
}

export function hideWorkspace(state: WorkspaceState, id: string): WorkspaceState {
  const visible = state.workspaces.filter(w => !w.hidden)
  const index = visible.findIndex(w => w.id === id)
  const next = visible[index + 1] || visible[index - 1]
  return {
    ...state,
    activeID: state.activeID === id ? next?.id || HOME : state.activeID,
    workspaces: state.workspaces.map(w => w.id === id ? { ...w, hidden: true } : w),
  }
}

export function addTab(workspace: Workspace, tab: StageTab, pane = workspace.focusedPane): Workspace {
  // Utility panes are unique per workspace; browser tabs aren't.
  const existing = tab.kind !== 'browser' && workspace.tabs.find(t => t.kind === tab.kind)
  if (existing) {
    const owner = workspace.tabPane[existing.id] ?? 0
    return { ...workspace, focusedPane: owner, panes: workspace.panes.map((t, i) => i === owner ? existing.id : t) as Workspace['panes'] }
  }
  return {
    ...workspace,
    tabs: [...workspace.tabs, tab],
    tabPane: { ...workspace.tabPane, [tab.id]: pane },
    panes: workspace.panes.map((id, i) => i === pane ? tab.id : id) as Workspace['panes'],
  }
}

export function selectTab(workspace: Workspace, id: string): Workspace {
  const pane = workspace.tabPane[id] ?? 0
  return { ...workspace, focusedPane: pane, panes: workspace.panes.map((t, i) => i === pane ? id : t) as Workspace['panes'] }
}

export function closeTab(workspace: Workspace, id: string): Workspace {
  const closed = workspace.tabs.find(t => t.id === id)
  if (!closed) return workspace
  const tabs = workspace.tabs.filter(t => t.id !== id)
  const pane = workspace.tabPane[id] ?? 0
  const next = tabs.filter(t => (workspace.tabPane[t.id] ?? 0) === pane).at(-1)
  const tabPane = { ...workspace.tabPane }
  delete tabPane[id]
  return {
    ...workspace, tabs, tabPane,
    panes: workspace.panes.map((t, i) => i === pane && t === id ? next?.id || null : t) as Workspace['panes'],
    closedTabs: [...workspace.closedTabs.slice(-9), closed],
  }
}

export function splitWorkspace(workspace: Workspace, direction: 'vertical' | 'horizontal'): Workspace {
  if (workspace.split === direction) {
    return {
      ...workspace, split: false, focusedPane: 0, fullscreen: false,
      tabPane: Object.fromEntries(workspace.tabs.map(t => [t.id, 0])),
      panes: [workspace.panes[workspace.focusedPane] || workspace.panes[0] || workspace.panes[1], null],
    }
  }
  if (workspace.split) return { ...workspace, split: direction }
  const second = workspace.tabs.find(t => t.id !== workspace.panes[0])
  return {
    ...workspace, split: direction, fullscreen: false,
    panes: [workspace.panes[0], second?.id || null],
    tabPane: { ...workspace.tabPane, ...(second ? { [second.id]: 1 as const } : {}) },
  }
}

export function moveTab(workspace: Workspace): Workspace {
  if (!workspace.split) return workspace
  const id = workspace.panes[workspace.focusedPane]
  if (!id) return workspace
  const from = workspace.focusedPane
  const to = (1 - from) as 0 | 1
  const next = workspace.tabs.find(t => t.id !== id && (workspace.tabPane[t.id] ?? 0) === from)
  return {
    ...workspace, focusedPane: to, tabPane: { ...workspace.tabPane, [id]: to },
    panes: from === 0 ? [next?.id || null, id] : [id, next?.id || null],
  }
}

export function restoreTab(workspace: Workspace): Workspace {
  const tab = workspace.closedTabs.at(-1)
  return tab ? addTab({ ...workspace, closedTabs: workspace.closedTabs.slice(0, -1) }, tab) : workspace
}

export function normalizeURL(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('Enter a URL')
  const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `${/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:|\/|$)/.test(value) ? 'http' : 'https'}://${value}`)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP and HTTPS URLs without embedded credentials are supported')
  }
  return url.href
}

export function restoreState(raw: string | null, directory: string): WorkspaceState {
  if (!raw) return initialState(directory)
  try {
    const value = JSON.parse(raw) as WorkspaceState
    if (value.version !== 1 || !Array.isArray(value.workspaces)) return initialState(directory)
    const workspaces = value.workspaces.filter(w =>
      w && typeof w.id === 'string' && ['session', 'web'].includes(w.kind) &&
      typeof w.title === 'string' && Array.isArray(w.tabs) && Array.isArray(w.panes) &&
      w.panes.length === 2 && w.tabPane && typeof w.draft === 'string' &&
      Array.isArray(w.context) && Array.isArray(w.closedTabs),
    ).map(w => ({ ...w, context: w.context.filter(c => c.kind !== 'image') }))
    return {
      version: 1, workspaces,
      activeID: workspaces.some(w => !w.hidden && w.id === value.activeID) ? value.activeID : HOME,
      folders: Array.isArray(value.folders) ? value.folders.filter(p => typeof p === 'string') : [],
      selectedDirectory: typeof value.selectedDirectory === 'string' ? value.selectedDirectory : directory,
      pinned: Array.isArray(value.pinned) ? value.pinned.filter(p => typeof p === 'string') : [],
      homeDraft: typeof value.homeDraft === 'string' ? value.homeDraft : '',
    }
  } catch { return initialState(directory) }
}

export function serializableState(state: WorkspaceState): string {
  // Screenshots can be large. Keep drafts and page/file context, not image blobs.
  return JSON.stringify({ ...state, workspaces: state.workspaces.map(w => ({ ...w, context: w.context.filter(c => c.kind !== 'image') })) })
}
