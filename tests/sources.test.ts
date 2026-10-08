import { describe, expect, it } from 'vitest'
import { launcherIntent, launcherScope, resourceAction, resourceSource } from '../src/shared/sources'
import { browserTile, fileTile } from '../src/shared/tiles'
import { projectTile, sessionIntent, sessionsIntent } from '../src/shared/sources/opencode'

describe('source/resource/action launcher semantics', () => {
  it('plain open/find project requests do not create a session or pick a source', () => {
    for (const query of ['chatos', 'open chatos', 'find chatos', 'go to chatos']) expect(launcherIntent(query)).toEqual({ query: 'chatos', source: undefined })
  })
  it('supports optional source prefixes and deliberate browse/session verbs', () => {
    expect(launcherIntent('OpenCode chatos')).toEqual({ source: 'opencode', query: 'chatos' })
    expect(launcherIntent('files: /home/me')).toEqual({ source: 'files', query: '/home/me' })
    expect(launcherIntent('Browse the chatos files.')).toEqual({ source: 'files', query: 'chatos' })
    expect(launcherIntent('Browse files in chatos')).toEqual({ source: 'files', query: 'chatos' })
    // Session verbs belong to the OpenCode source, not the core launcher.
    expect(sessionsIntent('Open the chatos sessions in OpenCode.')).toBe('chatos')
    expect(sessionIntent('Start an OpenCode session in chatos')).toEqual({ project: 'chatos', message: '' })
    expect(sessionIntent('start session in chatos: make headers draggable')).toEqual({ project: 'chatos', message: 'make headers draggable' })
    expect(sessionIntent('chatos')).toBeUndefined()
    expect(launcherIntent('chatos', 'files')).toEqual({ source: 'files', query: 'chatos' })
  })
  it('keeps mail filter syntax intact and separates URLs by provider rather than title', () => {
    expect(launcherScope('PR cleanup')).toBeUndefined()
    expect(launcherScope('DM Carl · important')).toBeUndefined()
    expect(launcherScope('github reviews')).toBe('github')
    expect(launcherScope('PR cleanup', 'github')).toBe('github')
    expect(launcherIntent('mail from:carl@example.test')).toMatchObject({ source: 'front', query: 'from:carl@example.test' })
    expect(launcherIntent('dm Carl')).toMatchObject({ source: 'slack', query: 'Carl' })
    expect(resourceSource(browserTile('https://github.com/example/repo'))).toBe('github')
    expect(resourceSource({ ...browserTile('https://example.test'), title: 'GitHub Slack' })).toBe('web')
  })
  it('explains different actions for the same path', () => {
    expect(resourceAction(fileTile('/home/me/chatos'))).toBe('Files · Folder · Browse files')
    expect(resourceAction(projectTile('/home/me/chatos'))).toBe('OpenCode · Project · Show sessions')
  })
})
