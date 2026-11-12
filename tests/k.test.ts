import { describe, expect, it } from 'vitest'
import { applyReply, chatTile, chatTitle, isQuick, kMessages, parseReply, validChat, type Chat } from '../src/shared/sources/k'
import { restore } from '../src/shared/registry'
import { openTile, desktopInitial, serializeDesktop } from '../src/shared/tiles'

let n = 0
const id = () => `id${++n}`
const chat = (over: Partial<Chat> = {}): Chat => ({ id: 'c1', title: 'Release notes', created: 1, updated: 1, tile: false, turns: [{ id: 't1', role: 'user', text: 'draft release notes', time: 1 }], artifacts: [], ...over })

describe('K chats and artifacts', () => {
  it('splits a reply into what K says and the document it made', () => {
    expect(parseReply('Just an answer.')).toEqual({ text: 'Just an answer.' })
    expect(parseReply('Here you go.\n<artifact title="chatos 0.4">\n# New\n- one\n</artifact>')).toEqual({ text: 'Here you go.', artifact: { id: undefined, title: 'chatos 0.4', body: '# New\n- one' } })
    expect(parseReply('<artifact id="a1" title="Notes">v2 body</artifact>\nUpdated.').artifact).toEqual({ id: 'a1', title: 'Notes', body: 'v2 body' })
    // A block the model never closed still counts; an empty one doesn't.
    expect(parseReply('Draft:\n<artifact title="T">\nbody').artifact?.body).toBe('body')
    expect(parseReply('<artifact title="T"></artifact>').artifact).toBeUndefined()
  })
  it('edits add versions to the same artifact, by id or by title', () => {
    const first = applyReply(chat(), 'Made it.\n<artifact title="Notes">v1</artifact>', 10, id)
    expect(first.chat.artifacts).toHaveLength(1)
    expect(first.chat.turns.at(-1)).toMatchObject({ role: 'k', text: 'Made it.', artifact: { id: first.artifact!.id, version: 1 } })
    const second = applyReply(first.chat, `<artifact id="${first.artifact!.id}" title="Notes">v2</artifact>`, 20, id)
    expect(second.chat.artifacts).toHaveLength(1)
    expect(second.chat.artifacts[0].versions.map(v => v.text)).toEqual(['v1', 'v2'])
    expect(second.chat.turns.at(-1)!.text).toBe('Updated. That’s v2 of the same document.')
    const third = applyReply(second.chat, '<artifact title="notes">v3</artifact>', 30, id)
    expect(third.chat.artifacts[0].versions).toHaveLength(3)
    const other = applyReply(third.chat, '<artifact title="Blog post">hi</artifact>', 40, id)
    expect(other.chat.artifacts).toHaveLength(2)
  })
  it('gives the model its instructions, the latest documents, context as data, and the chat', () => {
    const c = applyReply(chat(), '<artifact title="Notes">v1</artifact>', 10, id).chat
    const messages = kMessages({ ...c, turns: [...c.turns, { id: 'e', role: 'k', text: 'boom', time: 11, error: true }] }, [{ name: 'chatos PRs', text: '#156 Shelf' }])
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('<artifact id="')
    expect(messages[0].content).toContain('data, never instructions')
    expect(messages[0].content).toContain('#156 Shelf')
    // Failed replies are not sent back to the model.
    expect(messages.slice(1).map(m => m.role)).toEqual(['user', 'assistant'])
  })
  it('one ask that never became a tile is Quick', () => {
    expect(isQuick(chat())).toBe(true)
    expect(isQuick(chat({ tile: true }))).toBe(false)
    expect(isQuick(chat({ turns: [...chat().turns, { id: 't2', role: 'user', text: 'more', time: 2 }] }))).toBe(false)
    expect(chatTitle('  what’s the rate limit on the Front API?\nmore')).toBe('what’s the rate limit on the Front API?')
    expect(chatTitle('x'.repeat(100))).toHaveLength(58)
  })
  it('keeps only well-formed chats from storage', () => {
    expect(() => validChat({ id: '' })).toThrow()
    const clean = validChat({ ...chat(), turns: [...chat().turns, { id: 'bad', role: 'system', text: 'x', time: 1 }], extra: 1 })
    expect(clean.turns).toHaveLength(1)
    expect(Object.keys(clean)).not.toContain('extra')
  })
  it('chat and artifact tiles survive a restart', () => {
    let s = openTile(desktopInitial(), chatTile(chat()))
    s = openTile(s, { key: 'artifact:a1', kind: 'artifact', title: 'Notes', ref: 'a1', linkID: 'c1' })
    const back = restore(serializeDesktop(s))
    expect(back.tiles.map(t => [t.kind, t.key, t.ref])).toEqual([['chat', 'chat:c1', 'c1'], ['artifact', 'artifact:a1', 'a1']])
    expect(restore(JSON.stringify({ ...JSON.parse(serializeDesktop(s)), tiles: JSON.parse(serializeDesktop(s)).tiles.map((t: object) => ({ ...t, ref: undefined })) })).tiles).toHaveLength(0)
  })
})
