import { describe, expect, it } from 'vitest'
import { addTab, closeTab, hideWorkspace, initialState, moveTab, normalizeURL, openSession, restoreState, restoreTab, serializableState, splitWorkspace } from '../src/shared/sources/opencode/legacy'
import type { SessionInfo } from '../src/shared/sources/opencode/types'
import { shortcutFor, windowChord } from '../src/shared/shortcuts'

const session: SessionInfo = { id: 'ses_test', projectID: 'project', title: 'Test session', cost: 0, tokens: { input: 0, output: 0 }, time: { created: 1, updated: 1 }, location: { directory: '/workspace' } }

describe('workspace lifecycle', () => {
  it('hides and reopens a session without losing its draft, tabs, or split', () => {
    let state = openSession(initialState('/workspace'), session)
    let workspace = { ...state.workspaces[0], draft: 'Keep my draft' }
    workspace = addTab(workspace, { id: 'browser', kind: 'browser', title: 'Browser', url: 'https://example.com/' })
    workspace = addTab(workspace, { id: 'review', kind: 'review', title: 'Review' })
    workspace = splitWorkspace(workspace, 'vertical')
    state = { ...state, workspaces: [workspace] }
    const hidden = hideWorkspace(state, workspace.id)
    expect(hidden.activeID).toBe('home')
    expect(hidden.workspaces[0].hidden).toBe(true)
    const reopened = openSession(hidden, session)
    expect(reopened.workspaces).toHaveLength(1)
    expect(reopened.workspaces[0]).toEqual({ ...workspace, hidden: false })
  })
  it('moves, closes, and reopens tabs while keeping a single owner', () => {
    let workspace = openSession(initialState(), session).workspaces[0]
    workspace = addTab(workspace, { id: 'browser', kind: 'browser', title: 'Browser', url: 'https://example.com/' })
    workspace = addTab(workspace, { id: 'review', kind: 'review', title: 'Review' })
    workspace = splitWorkspace(workspace, 'vertical')
    workspace = moveTab(workspace)
    expect(workspace.focusedPane).toBe(1)
    expect(workspace.panes[1]).toBe('review')
    expect(workspace.tabPane.review).toBe(1)
    workspace = closeTab(workspace, 'review')
    expect(workspace.tabs).toHaveLength(1)
    workspace = restoreTab(workspace)
    expect(workspace.tabs).toHaveLength(2)
    expect(workspace.panes[1]).toBe('review')
    workspace = splitWorkspace(workspace, 'vertical')
    expect(workspace.split).toBe(false)
    expect(Object.values(workspace.tabPane)).toEqual([0, 0])
  })
  it('keeps utility tabs unique', () => {
    let workspace = openSession(initialState(), session).workspaces[0]
    workspace = addTab(workspace, { id: 'first', kind: 'review', title: 'Review' })
    workspace = addTab(workspace, { id: 'second', kind: 'review', title: 'Review' })
    expect(workspace.tabs).toHaveLength(1)
    expect(workspace.panes[0]).toBe('first')
  })
  it('restores local state without storing large screenshots', () => {
    const state = openSession(initialState('/workspace'), session)
    state.workspaces[0].draft = 'Remember me'
    state.workspaces[0].context = [{ id: 'image', kind: 'image', name: 'Screenshot', uri: 'data:image/png;base64,big' }]
    const restored = restoreState(serializableState(state), '')
    expect(restored.workspaces[0].draft).toBe('Remember me')
    expect(restored.workspaces[0].context).toEqual([])
    expect(restoreState('not json', '/workspace')).toEqual(initialState('/workspace'))
    expect(restoreState('{"version":99,"workspaces":[]}', '/workspace')).toEqual(initialState('/workspace'))
  })
})

describe('browser URL boundary', () => {
  it('defaults local previews to http and public websites to https', () => {
    expect(normalizeURL('localhost:3000')).toBe('http://localhost:3000/')
    expect(normalizeURL('127.0.0.1:3000/a')).toBe('http://127.0.0.1:3000/a')
    expect(normalizeURL('example.com')).toBe('https://example.com/')
  })
  it('rejects privileged schemes and embedded credentials', () => {
    for (const url of ['file:///etc/passwd', 'javascript://alert(1)', 'https://user:secret@example.com/']) expect(() => normalizeURL(url)).toThrow()
  })
})

describe('i3-style app shortcuts', () => {
  it('offers an app-local alternative when Linux captures Super', () => {
    const input = { type: 'keyDown', key: '2', control: true, alt: true, meta: false, shift: false } as Electron.Input
    expect(shortcutFor(input)).toBe('workspace:2')
    expect(shortcutFor({ ...input, control: false, alt: false, meta: true })).toBe('workspace:2')
    // Tile and app actions live under Ctrl+W and the leader (␣ / ⌘.), not on ⌘ keys.
    expect(shortcutFor({ ...input, key: 'w' })).toBeUndefined()
    expect(shortcutFor({ ...input, key: 'q', shift: true })).toBeUndefined()
    expect(shortcutFor({ ...input, key: '-' })).toBeUndefined()
    expect(shortcutFor({ ...input, key: '.' })).toBe('actions')
    expect(shortcutFor({ ...input, key: 't', alt: false, shift: true })).toBeUndefined()
    // System+Enter is left to lists (open beside); Ctrl+W x promotes.
    expect(shortcutFor({ ...input, key: 'enter' })).toBeUndefined()
    expect(shortcutFor({ ...input, key: '[' })).toBe('tile-back')
    // Shift+digit is not ours (⌘⇧3/4/5 are macOS screenshots): Ctrl+W, then a digit moves a tile.
    expect(shortcutFor({ ...input, key: '2', shift: true })).toBeUndefined()
    expect(shortcutFor({ ...input, key: '@', code: 'Digit2', shift: true })).toBeUndefined()
    expect(windowChord['2']).toBe('move-workspace:2')
    // Never the OS's: app switcher, Spotlight/layouts, hide, lock, window snapping, Ubuntu's terminal.
    for (const [key, mods] of [['Tab', { meta: true }], [' ', { meta: true }], [' ', { control: true, alt: false }], ['h', { meta: true }], ['l', { meta: true }], ['ArrowLeft', { meta: true }], ['t', { control: true, alt: true }], ['ArrowRight', { control: true, alt: true }]] as const)
      expect(shortcutFor(Object.assign({}, input, { key, control: false, alt: false, meta: false }, mods))).toBeUndefined()
    expect(shortcutFor({ ...input, control: false, alt: false })).toBeUndefined()
  })
})
