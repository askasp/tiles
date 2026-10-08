import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Storage } from '../src/main/storage'
import { desktopInitial, openTile, projectTile, serializeDesktop, updateTile } from '../src/shared/tiles'
import { exampleConnector } from '../src/shared/connectors'
import { Services } from '../src/main/services'

const directories: string[] = [], stores: Storage[] = []
const codec = { available: () => true, encrypt: (s: string) => Buffer.from(s.split('').reverse().join('')), decrypt: (b: Buffer) => b.toString().split('').reverse().join('') }
function setup() { const directory = mkdtempSync('/tmp/opencode/chatos-db-'); directories.push(directory); const store = new Storage(directory); stores.push(store); return store }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('durable main-process SQLite storage', () => {
  it('migrates the legacy desktop only once and preserves drafts and recovery input', () => {
    const store = setup(), state = openTile(desktopInitial(), projectTile('/private/project'))
    const raw = serializeDesktop(updateTile(state, state.tiles[0].id, { draft: 'Private draft' }))
    expect(store.loadDesktop(raw)).toContain('Private draft')
    expect(store.get('legacy-desktop')).toBe(raw)
    expect(store.loadDesktop(serializeDesktop(desktopInitial()))).toContain('Private draft')
    expect(statSync(store.path).mode & 0o777).toBe(0o600)
  })
  it('keeps the previous save on malformed or oversized writes', () => {
    const store = setup(), raw = serializeDesktop(desktopInitial())
    store.saveDesktop(raw)
    expect(() => store.saveDesktop('{bad')).toThrow()
    expect(() => store.saveDesktop('x'.repeat(8_000_001))).toThrow()
    expect(store.loadDesktop()).toBe(raw)
    expect(() => store.loadDesktop('{bad')).not.toThrow()
  })
  it('atomically versions recipes and rejects stale edits without altering history', () => {
    const store = setup()
    expect(store.saveConnector(exampleConnector, 0)).toBe(1)
    expect(store.saveConnector({ ...exampleConnector, name: 'Adjusted' }, 1)).toBe(2)
    expect(() => store.saveConnector(exampleConnector, 1)).toThrow('changed')
    expect(store.revisions(exampleConnector.id).map(r => r.revision)).toEqual([2, 1])
    expect(store.definitions()[0].definition.name).toBe('Adjusted')
  })
  it('clears credentials in the same transaction as a destination/auth change', () => {
    const store = setup(); store.saveConnector(exampleConnector, 0)
    store.saveSecret('connector:helpdesk', codec.encrypt('old-destination-token'))
    store.saveSecret('oauth:helpdesk', codec.encrypt('old-oauth-state'))
    store.saveConnector({ ...exampleConnector, baseURL: 'https://new.example.test' }, 1)
    expect(store.secret('connector:helpdesk')).toBeUndefined(); expect(store.secret('oauth:helpdesk')).toBeUndefined()
    expect(store.definitions()[0].revision).toBe(2)
  })
  it('creates consistent backups readable independently of the live WAL', () => {
    const store = setup()
    store.saveDesktop(serializeDesktop(openTile(desktopInitial(), projectTile('/private'))))
    store.saveConnector(exampleConnector, 0)
    const backup = store.backup(), db = new DatabaseSync(backup, { readOnly: true })
    try {
      expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok')
      expect(db.prepare('SELECT value FROM app_state WHERE key=?').get('desktop')?.value).toContain('/private')
      expect(db.prepare('SELECT revision FROM connectors').get()?.revision).toBe(1)
      expect(statSync(backup).mode & 0o777).toBe(0o600)
    } finally { db.close() }
  })
  it('rejects newer schemas without resetting the file', () => {
    const dir = mkdtempSync('/tmp/opencode/chatos-db-newer-'); directories.push(dir)
    const db = new DatabaseSync(`${dir}/chatos.sqlite`); db.exec('PRAGMA user_version=999; CREATE TABLE user_work (value TEXT);'); db.close()
    expect(() => new Storage(dir)).toThrow('newer')
    const unchanged = new DatabaseSync(`${dir}/chatos.sqlite`)
    expect(unchanged.prepare('PRAGMA user_version').get()?.user_version).toBe(999); unchanged.close()
  })
  it('migrates provider settings and ciphertext without storing plaintext', async () => {
    const store = setup(), token = 'sensitive-private-token'
    writeFileSync(`${store.directory}/services.json`, JSON.stringify({ front: { url: 'https://app.frontapp.com/', encryptedToken: codec.encrypt(token).toString('base64') } }))
    const services = new Services(store.directory, codec, fetch, store)
    expect((await services.list()).find(s => s.id === 'front')?.hasToken).toBe(true)
    expect(store.get('services')).not.toContain('encryptedToken')
    expect(store.secret('service:front')).toEqual(codec.encrypt(token))
    expect(readFileSync(store.backup()).includes(Buffer.from(token))).toBe(false)
    await services.disconnect('front')
    expect(store.secret('service:front')).toBeUndefined()
    expect((await new Services(store.directory, codec, fetch, store).list()).find(s => s.id === 'front')?.hasToken).toBe(false)
  })
})
