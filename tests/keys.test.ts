import { describe, expect, it } from 'vitest'
import type { Input } from 'electron'
import { createShortcutReader, keyHelp, leader, pageKeepsKey, shortcutFor, windowChord, type LeaderEntry } from '../src/shared/shortcuts'
import { validateActions } from '../src/renderer/actions'

const family = (action: string) => action.split(':')[0]
const walk = (entries: Record<string, LeaderEntry>): string[] => Object.values(entries).flatMap(e => [...(e.action ? [e.action] : []), ...(e.keys ? walk(e.keys) : [])])
const leaderActions = walk(leader)
const documented = new Set(keyHelp('Super').flatMap(group => group.rows.flatMap(row => (row.actions || []).map(family))))
const keys = [...'abcdefghijklmnopqrstuvwxyz0123456789.,-=+/ ', 'Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'F2', 'F6', 'Escape']
const press = (key: string, mods: Partial<Input> = {}) => ({ type: 'keyDown', key, code: /^[0-9]$/.test(key) ? `Digit${key}` : '', control: false, alt: false, meta: false, shift: false, ...mods }) as Input

describe('key sheet', () => {
  it('documents every shortcut the app answers to', () => {
    const modifiers: Partial<Input>[] = [{}, { meta: true }, { meta: true, shift: true }, { control: true }, { control: true, shift: true }, { control: true, alt: true }, { alt: true }]
    const answered = new Set<string>()
    for (const key of keys) for (const mods of modifiers) { const action = shortcutFor(press(key, mods)); if (action) answered.add(family(action)) }
    for (const action of Object.values(windowChord)) answered.add(family(action))
    for (const action of leaderActions) answered.add(family(action))
    expect([...answered].filter(action => !documented.has(action))).toEqual([])
  })
  it('only documents actions that exist', () => {
    const real = new Set([...leaderActions, ...keys.flatMap(key => [{}, { meta: true }, { meta: true, shift: true }, { control: true }, { control: true, shift: true }, { alt: true }].map(mods => shortcutFor(press(key, mods)))), ...Object.values(windowChord)].filter(Boolean).map(a => family(a!)))
    expect([...documented].filter(action => !real.has(action))).toEqual([])
  })
  it('opens the action menu and the key sheet from anywhere', () => {
    expect(shortcutFor(press('.', { meta: true }))).toBe('actions')
    expect(shortcutFor(press('.', { control: true, alt: true }))).toBe('actions')
    expect(shortcutFor(press('/', { meta: true }))).toBe('keys')
    expect(shortcutFor(press('.', { control: true }))).toBe('attach-selection')
  })
})

describe('leader', () => {
  it('has one home per action: every Ctrl+W action is under ␣ w, and app actions left the accelerators', () => {
    const w = new Set(Object.values(leader.w.keys!).map(e => e.action))
    for (const action of new Set(Object.values(windowChord))) expect(w.has(action)).toBe(true)
    for (const key of ['w', 'f', '-', '=', 't', 'n', 'u', 'z', 'o', 'Tab']) expect(shortcutFor(press(key, { meta: true }))).toBeUndefined()
    expect(shortcutFor(press('Tab', { control: true }))).toBeUndefined()
    expect(shortcutFor(press('b', { control: true, shift: true }))).toBeUndefined()
    expect(shortcutFor(press('t', { control: true }))).toBeUndefined()
  })
  it('leaves Ctrl+K/I/O/Tab to web pages, but ⌘K still opens K', () => {
    for (const key of ['k', 'i', 'o', 'Tab']) expect(pageKeepsKey(press(key, { control: true }))).toBe(true)
    expect(pageKeepsKey(press('k', { meta: true }))).toBe(false)
    expect(pageKeepsKey(press('w', { control: true }))).toBe(false)
  })
})

describe('Ctrl+W chord', () => {
  it('has a hint group listing every chord key', () => {
    for (const system of ['⌘', 'Super']) expect(keyHelp(system).filter(g => g.chord)).toHaveLength(1)
  })
  it('pairs with the next key, gives up after 1.5 s, and cancels on Escape', () => {
    let now = 0
    const read = createShortcutReader(() => now)
    expect(read(press('w', { control: true }))).toEqual({ action: 'chord', swallow: true })
    expect(read(press('l'))).toEqual({ action: 'focus:right', swallow: true })
    expect(read(press('l'))).toEqual({ action: undefined, swallow: false })
    read(press('w', { control: true })); expect(read(press('Escape'))).toEqual({ action: 'chord-cancel', swallow: true })
    read(press('w', { control: true })); now = 2000; expect(read(press('l')).action).toBeUndefined()
    read(press('w', { control: true })); expect(read(press('Shift')).swallow).toBe(false); expect(read(press('L', { shift: true })).action).toBe('swap:right')
  })
})

describe('tile action keys', () => {
  it('drops reserved, duplicate and long keys but keeps the action', () => {
    const run = () => {}
    const { actions, problems } = validateActions([
      { id: 'a', label: 'Refresh', key: 'r', run }, { id: 'b', label: 'Reload', key: 'r', run },
      { id: 'c', label: 'Down', key: 'j', run }, { id: 'd', label: 'Menu', key: ' ', run }, { id: 'e', label: 'Long', key: 'rr', run },
    ])
    expect(actions.map(a => a.key)).toEqual(['r', undefined, undefined, undefined, undefined])
    expect(problems).toHaveLength(4)
  })
})
