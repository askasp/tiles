import { describe, expect, it } from 'vitest'
import { activeMention, fileMentions, leadingSlash, slashMentions } from '../src/shared/sources/opencode/mentions'

describe('opencode mentions', () => {
  it('finds @paths with their offsets, without trailing punctuation', () => {
    const text = 'look at @src/a.ts, and @docs/ please'
    expect(fileMentions(text)).toEqual([
      { path: 'src/a.ts', start: 8, end: 17, text: '@src/a.ts' },
      { path: 'docs/', start: 23, end: 29, text: '@docs/' },
    ])
    expect(fileMentions('mail me@example.com')).toEqual([])
  })

  it('finds only known /skills', () => {
    expect(slashMentions('/review this and /nope then /report.', new Set(['review', 'report']))).toEqual([
      { name: 'review', start: 0, end: 7, text: '/review' },
      { name: 'report', start: 28, end: 35, text: '/report' },
    ])
  })

  it('splits a leading command from its arguments', () => {
    expect(leadingSlash('/review the auth module')).toEqual({ name: 'review', args: 'the auth module' })
    expect(leadingSlash('/init')).toEqual({ name: 'init', args: '' })
    expect(leadingSlash('please /review')).toBeUndefined()
  })

  it('reports the token at the caret', () => {
    expect(activeMention('fix @src/ren', 12)).toEqual({ kind: '@', query: 'src/ren', start: 4, end: 12 })
    expect(activeMention('/rev', 4)).toEqual({ kind: '/', query: 'rev', start: 0, end: 4 })
    expect(activeMention('@ab more', 2)).toEqual({ kind: '@', query: 'a', start: 0, end: 3 })
    expect(activeMention('cd /usr/bin', 11)).toBeUndefined()
    expect(activeMention('plain text', 10)).toBeUndefined()
  })
})
