import { describe, expect, it } from 'vitest'
import { activeWorkspace, browserTile, desktopInitial, directionTile, focusTile, focusedTile, fullscreenTile, goWorkspace, moveTile, neighbourIndex, openTile, promoteTile, reconcileBrowser, restoreLast, serializeDesktop, shelfTile, tidyAround, undoArrangement, updateTile, type TileDesktop } from '../src/shared/tiles'
import type { SessionInfo } from '../src/shared/sources/opencode/types'
import { projectTile, sessionTile } from '../src/shared/sources/opencode'
import { restore as restoreDesktop } from '../src/shared/registry'

const session = (n: number, project = '/projects/amino'): SessionInfo => ({ id: `session-${n}`, projectID: project, title: `Task ${n}`, cost: 0, tokens: { input: 0, output: 0 }, location: { directory: project }, time: { created: n, updated: n } })
function valid(s: TileDesktop) {
  expect(new Set(s.tiles.map(t => t.key)).size).toBe(s.tiles.length)
  expect(new Set(s.tiles.map(t => t.id)).size).toBe(s.tiles.length)
  expect(new Set(s.workspaces.map(w => w.slot)).size).toBe(s.workspaces.length)
  const owners = s.workspaces.flatMap(w => w.tileIDs)
  expect(new Set(owners).size).toBe(owners.length)
  for (const w of s.workspaces) {
    expect(w.tileIDs.length).toBeLessThanOrEqual(4)
    for (const id of w.tileIDs) { const t = s.tiles.find(t => t.id === id)!; expect(t.workspaceID).toBe(w.id); expect(t.status).toBe('visible') }
    if (w.focusedID) expect(w.tileIDs).toContain(w.focusedID)
    if (w.fullscreenID) expect(w.tileIDs).toContain(w.fullscreenID)
  }
  for (const t of s.tiles) expect(owners.filter(id => id === t.id)).toHaveLength(t.status === 'visible' ? 1 : 0)
}

describe('V3 unique global resource ownership', () => {
  it('opens a session here and jumps to its existing workspace even for new-mode', () => {
    let s = openTile(desktopInitial(), sessionTile(session(1)))
    const owner = s.activeID
    s = goWorkspace(s, 2)
    s = openTile(s, sessionTile(session(1)), 'new')
    expect(s.tiles).toHaveLength(1); expect(s.activeID).toBe(owner)
    valid(s)
  })
  it('uses canonical URLs but preserves different queries/fragments as different resources', () => {
    let s = openTile(desktopInitial(), browserTile('EXAMPLE.com:443'))
    s = openTile(s, browserTile('https://example.com/'))
    expect(s.tiles).toHaveLength(1)
    for (const url of ['https://example.com/?filter=me', 'https://example.com/#carl']) s = openTile(s, browserTile(url))
    expect(s.tiles).toHaveLength(3); valid(s)
  })
  it('never re-numbers surviving workspaces after another empties', () => {
    let s = openTile(goWorkspace(desktopInitial(), 1), sessionTile(session(1)))
    s = openTile(goWorkspace(s, 2), sessionTile(session(2)))
    s = shelfTile(s, 'session-1')
    expect(s.workspaces.map(w => w.slot)).toEqual([2])
    s = goWorkspace(s, 1)
    expect(s.workspaces.map(w => w.slot)).toEqual([1, 2]); valid(s)
  })
  it('moves the exact session and linked preview, retaining drafts and browser IDs', () => {
    let s = openTile(desktopInitial(), sessionTile(session(1)))
    s = updateTile(s, 'session-1', { draft: 'Unsent plan' })
    s = openTile(s, browserTile('localhost:3000', 'session-1'))
    const browser = focusedTile(s)!.id
    s = moveTile(s, 'session-1', 4)
    expect(activeWorkspace(s)?.tileIDs).toEqual(['session-1', browser])
    expect(s.tiles.find(t => t.id === 'session-1')?.draft).toBe('Unsent plan')
    expect(s.workspaces).toHaveLength(1); valid(s)
  })
  it('hides/restores linked session and preview together, but hides a preview alone', () => {
    let s = openTile(desktopInitial(), sessionTile(session(1)))
    s = openTile(s, browserTile('localhost:3000', 'session-1'))
    const preview = focusedTile(s)!.id
    s = shelfTile(s, preview)
    expect(s.tiles.find(t => t.id === 'session-1')?.status).toBe('visible')
    s = focusTile(s, preview)
    s = shelfTile(s, 'session-1')
    expect(s.tiles.every(t => t.status === 'shelf')).toBe(true)
    s = focusTile(s, 'session-1')
    expect(s.tiles.every(t => t.status === 'visible')).toBe(true); valid(s)
  })
  it('moving a linked preview brings its parent too; ordinary unshelving rejoins the parent', () => {
    let s = openTile(desktopInitial(), sessionTile(session(1)))
    s = openTile(s, browserTile('localhost:3000', 'session-1'))
    const preview = focusedTile(s)!.id
    s = moveTile(s, preview, 3)
    expect(activeWorkspace(s)?.tileIDs).toContain('session-1')
    s = shelfTile(s, preview); s = goWorkspace(s, 2); s = focusTile(s, preview)
    expect(activeWorkspace(s)?.slot).toBe(3)
    expect(activeWorkspace(s)?.tileIDs).toHaveLength(2); valid(s)
  })
  it('merges redirect collisions and cannot resurrect duplicate owners by undo', () => {
    let s = openTile(desktopInitial(), browserTile('https://example.com/a'))
    const original = focusedTile(s)!.id
    s = openTile(goWorkspace(s, 2), browserTile('https://example.com/b'))
    const redirecting = focusedTile(s)!.id
    s = reconcileBrowser(s, redirecting, 'https://example.com/a', 'A')
    expect(focusedTile(s)?.id).toBe(original)
    expect(s.tiles).toHaveLength(1); valid(s)
    s = undoArrangement(s); valid(s)
  })
  it('local browser names survive title changes, shelving, and persistence', () => {
    let s = openTile(desktopInitial(), browserTile('https://app.slack.com/client/team/dm'))
    const id = focusedTile(s)!.id
    s = updateTile(s, id, { label: 'DM Carl' })
    s = reconcileBrowser(s, id, 'https://app.slack.com/client/team/dm', 'Slack')
    s = shelfTile(s, id)
    const restored = restoreDesktop(serializeDesktop(s))
    expect(restored.tiles[0].label).toBe('DM Carl'); expect(restored.tiles[0].title).toBe('Slack'); valid(restored)
  })
  it('fifth visible tile shelves the LRU, never the requested one', () => {
    let s = desktopInitial()
    for (let n = 1; n <= 4; n++) s = openTile(s, sessionTile(session(n)))
    s = focusTile(s, 'session-1')
    s = openTile(s, sessionTile(session(5)))
    expect(s.tiles.find(t => t.id === 'session-2')?.status).toBe('shelf')
    expect(s.tiles.find(t => t.id === 'session-5')?.status).toBe('visible')
    expect(focusedTile(s)?.id).toBe('session-5'); valid(s)
  })
  it('automatic LRU shelving carries the hidden session’s linked preview', () => {
    let s = openTile(desktopInitial(), sessionTile(session(1)))
    s = openTile(s, browserTile('localhost:3000', 'session-1'))
    const preview = focusedTile(s)!.id
    for (let n = 2; n <= 4; n++) s = openTile(s, sessionTile(session(n)))
    expect(s.tiles.find(t => t.id === 'session-1')?.status).toBe('shelf')
    expect(s.tiles.find(t => t.id === preview)?.status).toBe('shelf')
    expect(activeWorkspace(s)?.tileIDs).toHaveLength(3); valid(s)
  })
  it('focusing an existing owner removes a temporary empty workspace without renumbering', () => {
    let s = openTile(desktopInitial(), sessionTile(session(1)))
    s = goWorkspace(s, 3)
    s = focusTile(s, 'session-1')
    expect(s.workspaces.map(w => w.slot)).toEqual([1]); valid(s)
  })
  it('restores closed resources and their linked previews without duplicate identities', () => {
    let s = openTile(desktopInitial(), sessionTile(session(1)))
    s = openTile(s, browserTile('localhost:3000', 'session-1'))
    s = shelfTile(s, 'session-1', true)
    s = openTile(s, sessionTile(session(1)))
    expect(s.tiles).toHaveLength(2); expect(s.tiles.every(t => t.status === 'visible')).toBe(true); valid(s)
  })
})

describe('V3 arrangement and persistence', () => {
  it('focuses and swaps spatial neighbours without changing focused resource', () => {
    let s = desktopInitial()
    for (let n = 1; n <= 4; n++) s = openTile(s, sessionTile(session(n)))
    s = focusTile(s, 'session-1'); s = directionTile(s, 'right')
    expect(focusedTile(s)?.id).toBe('session-2')
    s = directionTile(s, 'down', true)
    expect(activeWorkspace(s)?.tileIDs).toEqual(['session-1', 'session-4', 'session-3', 'session-2'])
    expect(focusedTile(s)?.id).toBe('session-2')
    s = promoteTile(s); expect(activeWorkspace(s)?.tileIDs[0]).toBe('session-2'); valid(s)
    expect(activeWorkspace(s)?.fullscreenID).toBe('session-2')
    s = promoteTile(s); expect(activeWorkspace(s)?.fullscreenID).toBeNull()
    expect(neighbourIndex(3, 0, 'right')).toBe(1)
    expect(neighbourIndex(3, 1, 'down')).toBe(2)
  })
  it('focus change while fullscreen reveals the chosen tile and exits cleanly', () => {
    let s = openTile(desktopInitial(), sessionTile(session(1)))
    s = openTile(s, sessionTile(session(2)))
    s = fullscreenTile(s); expect(activeWorkspace(s)?.fullscreenID).toBe('session-2')
    s = focusTile(s, 'session-1'); expect(activeWorkspace(s)?.fullscreenID).toBe('session-1')
    s = fullscreenTile(s); expect(activeWorkspace(s)?.fullscreenID).toBeNull(); valid(s)
  })
  it('tidies and undoes layouts without reverting edits made to drafts afterwards', () => {
    let s = openTile(desktopInitial(), sessionTile(session(1)))
    s = openTile(s, browserTile('localhost:3000', 'session-1'))
    s = openTile(s, browserTile('https://github.com/pulls'))
    s = tidyAround(s, 'session-1')
    expect(activeWorkspace(s)?.tileIDs).toHaveLength(2)
    s = updateTile(s, 'session-1', { draft: 'Typed after arrangement' })
    s = undoArrangement(s)
    expect(activeWorkspace(s)?.tileIDs).toHaveLength(3)
    expect(s.tiles.find(t => t.id === 'session-1')?.draft).toBe('Typed after arrangement'); valid(s)
  })
  it('round-trips shelf, stable slots, drafts and links, excluding screenshots/history', () => {
    let s = openTile(goWorkspace(desktopInitial('/projects/amino'), 5), sessionTile(session(1)))
    s = updateTile(s, 'session-1', { draft: 'Remember', context: [{ id: 'large', kind: 'image', name: 'shot', uri: 'data:image/png;base64,x' }] })
    s = openTile(s, browserTile('localhost:3000', 'session-1')); s = shelfTile(s, 'session-1')
    const restored = restoreDesktop(serializeDesktop(s))
    expect(restored.tiles[0].draft).toBe('Remember'); expect(restored.tiles[0].context).toEqual([])
    expect(restored.history).toEqual([]); expect(restored.tiles[1].linkID).toBe('session-1'); valid(restored)
  })
  it('migrates v1 without losing drafts or duplicating browser URLs', () => {
    const base = { kind: 'session', hidden: false, panes: [null, null], tabPane: {}, split: false, focusedPane: 0, fullscreen: false, context: [], closedTabs: [] }
    const raw = JSON.stringify({ version: 1, activeID: 'session-1', selectedDirectory: '/projects/amino', folders: [], pinned: [], homeDraft: 'Home draft', workspaces: [
      { ...base, id: 'session-1', sessionID: 'session-1', title: 'One', directory: '/projects/amino', draft: 'Draft one', tabs: [{ id: 'browser-1', kind: 'browser', title: 'Preview', url: 'http://localhost:3000/' }] },
      { ...base, id: 'session-2', sessionID: 'session-2', title: 'Two', directory: '/projects/amino', draft: 'Draft two', hidden: true, tabs: [{ id: 'browser-2', kind: 'browser', title: 'Preview', url: 'http://localhost:3000/' }] },
    ] })
    const s = restoreDesktop(raw)
    expect(s.tiles.filter(t => t.kind === 'browser')).toHaveLength(1)
    expect(s.tiles.find(t => t.id === 'session-1')?.draft).toBe('Draft one')
    expect(s.tiles.find(t => t.id === 'session-2')?.draft).toBe('Draft two')
    expect(s.tiles.find(t => t.id === 'session-1')?.status).toBe('visible')
    expect(s.tiles.find(t => t.id === 'session-2')?.status).toBe('shelf'); valid(s)
  })
  it('v1 review tabs in the same project become one repository review tile', () => {
    const base = { kind: 'session', hidden: false, panes: [null, null], tabPane: {}, split: false, focusedPane: 0, fullscreen: false, context: [], draft: '', closedTabs: [] }
    const raw = JSON.stringify({ version: 1, activeID: 'session-1', workspaces: [1, 2].map(n => ({ ...base, id: `session-${n}`, sessionID: `session-${n}`, directory: '/projects/amino', title: `Session ${n}`, tabs: [{ kind: 'review', id: `review-${n}`, title: 'Review' }] })) })
    const restored = restoreDesktop(raw)
    expect(restored.tiles.filter(t => t.kind === 'review')).toHaveLength(1)
    expect(restored.tiles.find(t => t.kind === 'review')?.key).toBe('review:/projects/amino'); valid(restored)
  })
  it('repairs malformed persisted duplicate keys and oversized workspaces', () => {
    let s = desktopInitial()
    for (let n = 1; n <= 4; n++) s = openTile(s, sessionTile(session(n)))
    const duplicate = { ...s.tiles[0], id: 'duplicate' }
    s.tiles.push(duplicate); s.workspaces[0].tileIDs.push(duplicate.id)
    const restored = restoreDesktop(JSON.stringify(s)); expect(restored.tiles).toHaveLength(4); valid(restored)
    expect(restoreDesktop('invalid')).toEqual(desktopInitial())
  })
  it('rebuilds session resource identities and drops malformed context rather than crashing', () => {
    const s = openTile(desktopInitial(), sessionTile(session(1)))
    const raw = JSON.parse(serializeDesktop(s))
    raw.tiles.push({ ...raw.tiles[0], id: 'copy', key: 'forged-key' })
    raw.tiles[0].context = [{ kind: 'page', id: 'bad', name: {} }]
    const restored = restoreDesktop(JSON.stringify(raw))
    expect(restored.tiles).toHaveLength(1)
    expect(restored.tiles[0].context).toEqual([]); valid(restored)
  })
})

describe('entire workday simulation', () => {
  it('survives 960 morning-to-evening session/DM/PR/mail switches and repeated restarts', () => {
    let s = desktopInitial('/projects/amino')
    for (let n = 1; n <= 5; n++) {
      s = goWorkspace(s, n <= 3 ? 1 : 2)
      s = openTile(s, sessionTile(session(n, n <= 3 ? '/projects/amino' : '/projects/health')))
      s = updateTile(s, `session-${n}`, { draft: `Draft for session ${n}` })
    }
    const urls = [
      'https://app.slack.com/client/team/carl', 'https://app.slack.com/client/team/kari', 'https://app.slack.com/client/team/mentions',
      'https://app.frontapp.com/inbox/me', 'https://app.frontapp.com/inbox/replies', 'https://app.frontapp.com/inbox/tagged',
      'https://github.com/pulls/review-requested', ...Array.from({ length: 12 }, (_, i) => `https://github.com/acme/amino/pull/${i + 1}`),
      'http://localhost:3000/', 'http://localhost:3001/',
    ]
    for (let minute = 0; minute < 480; minute++) {
      s = goWorkspace(s, minute % 3 + 1)
      s = openTile(s, sessionTile(session(minute % 5 + 1)), minute % 17 === 0 ? 'move' : 'here')
      s = openTile(s, browserTile(urls[minute % urls.length]), minute % 11 === 0 ? 'move' : 'here')
      if (minute % 7 === 0) s = shelfTile(s, focusedTile(s)!.id)
      if (minute % 9 === 0) s = restoreLast(s)
      if (minute % 13 === 0) { s = directionTile(s, 'left'); s = promoteTile(s) }
      if (minute % 23 === 0) { s = tidyAround(s, focusedTile(s)!.id); s = undoArrangement(s) }
      if (minute % 31 === 0) s = restoreDesktop(serializeDesktop(s))
      valid(s)
      for (let n = 1; n <= 5; n++) expect(s.tiles.find(t => t.id === `session-${n}`)?.draft).toBe(`Draft for session ${n}`)
    }
    expect(s.tiles.filter(t => t.kind === 'session')).toHaveLength(5)
    expect(s.tiles.filter(t => t.kind === 'browser').length).toBeLessThanOrEqual(urls.length)
    expect(s.workspaces.length).toBeLessThanOrEqual(3)
    expect(s.history.length).toBeLessThanOrEqual(25)
  })
})

describe('replacing a tile in place', () => {
  it('a session opened from its list takes the tile; nothing of the list carries over, and an open session is reused', async () => {
    const { replaceTile } = await import('../src/shared/tiles')
    let s = openTile(desktopInitial(), projectTile('/projects/amino'))
    const id = s.tiles[0].id
    s = { ...s, tiles: s.tiles.map(t => ({ ...t, draft: 'list draft', label: 'Amino' })) }
    s = replaceTile(s, id, sessionTile(session(1)))
    expect(s.tiles).toHaveLength(1)
    expect(s.tiles[0]).toMatchObject({ id, kind: 'session', sessionID: 'session-1', key: 'session:session-1', draft: '', label: undefined })
    s = openTile(s, sessionTile(session(2)))
    const before = s.tiles.length
    s = replaceTile(s, id, sessionTile(session(2)))
    expect(s.tiles).toHaveLength(before)
    expect(s.tiles.find(t => t.id === id)?.sessionID).toBe('session-1')
  })
})
