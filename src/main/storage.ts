import { DatabaseSync } from 'node:sqlite'
import { chmodSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { serializeDesktop } from '../shared/tiles'
import { restore } from '../shared/registry'
import { validateConnector, type ConnectorDefinition } from '../shared/connectors'

/** Single main-process writer. SQLite handles atomic commits and crash recovery. */
export class Storage {
  private db: DatabaseSync
  readonly path: string
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.path = join(directory, 'chatos.sqlite')
    const existing = existsSync(this.path)
    this.db = new DatabaseSync(this.path)
    chmodSync(this.path, 0o600)
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 1) { this.db.close(); throw new Error('This database was created by a newer ChatOS version. It has not been modified.') }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`)
    this.db.exec(`BEGIN;
      CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS desktop_snapshots (id INTEGER PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connectors (id TEXT PRIMARY KEY, definition TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connector_revisions (connector_id TEXT NOT NULL, revision INTEGER NOT NULL, definition TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(connector_id, revision));
      CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, encrypted BLOB NOT NULL);
      PRAGMA user_version=1;
      COMMIT;`)
    if (existing && Date.now() - Number(this.get('last-backup') || 0) > 86_400_000) {
      this.backup(); this.set('last-backup', String(Date.now()))
    }
  }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = run(); this.db.exec('COMMIT'); return value } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  get(key: string): string | null { return this.db.prepare('SELECT value FROM app_state WHERE key=?').get(key)?.value as string || null }
  delete(key: string) { this.db.prepare('DELETE FROM app_state WHERE key=?').run(key) }
  set(key: string, value: string) { this.db.prepare('INSERT INTO app_state VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at').run(key, value, Date.now()) }
  loadDesktop(legacy?: string | null): string | null {
    const saved = this.get('desktop')
    if (saved !== null) return saved
    if (!legacy) return null
    return this.transaction(() => {
      // Preserve original migration input in case a future migration needs it.
      this.set('legacy-desktop', legacy)
      const clean = this.cleanDesktop(legacy)
      this.set('desktop', clean)
      return clean
    })
  }
  private cleanDesktop(raw: string): string {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8_000_000) throw new Error('Desktop state is too large to save')
    const value = JSON.parse(raw)
    if (![1, 2].includes(value.version) || !Array.isArray(value.workspaces) || (value.version === 2 && !Array.isArray(value.tiles))) throw new Error('Invalid desktop state; previous save kept')
    return serializeDesktop(restore(raw))
  }
  saveDesktop(raw: string) {
    const clean = this.cleanDesktop(raw)
    if (this.get('desktop') === clean) return
    this.transaction(() => {
      const previous = this.get('desktop')
      const latest = this.db.prepare('SELECT created_at FROM desktop_snapshots ORDER BY id DESC LIMIT 1').get()
      if (previous && (!latest || Date.now() - Number(latest.created_at) > 60_000)) {
        this.db.prepare('INSERT INTO desktop_snapshots(value, created_at) VALUES (?, ?)').run(previous, Date.now())
        this.db.exec('DELETE FROM desktop_snapshots WHERE id NOT IN (SELECT id FROM desktop_snapshots ORDER BY id DESC LIMIT 10)')
      }
      this.set('desktop', clean)
    })
  }
  definitions(): { definition: ConnectorDefinition; revision: number }[] {
    return this.db.prepare('SELECT definition, revision FROM connectors ORDER BY id').all().map(row => ({ definition: validateConnector(JSON.parse(String(row.definition))), revision: Number(row.revision) }))
  }
  saveConnector(definition: ConnectorDefinition, expectedRevision: number): number {
    const clean = validateConnector(definition)
    return this.transaction(() => {
      const row = this.db.prepare('SELECT revision, definition FROM connectors WHERE id=?').get(clean.id)
      const current = Number(row?.revision || 0)
      if (current !== expectedRevision) throw new Error('Connector changed since you opened it. Reload before saving.')
      if (row) {
        const old = JSON.parse(String(row.definition)) as ConnectorDefinition
        if (old.baseURL !== clean.baseURL || JSON.stringify(old.auth) !== JSON.stringify(clean.auth)) {
          this.saveSecret(`connector:${clean.id}`); this.saveSecret(`oauth:${clean.id}`)
        }
      }
      const revision = current + 1, json = JSON.stringify(clean), time = Date.now()
      this.db.prepare('INSERT INTO connectors VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition, revision=excluded.revision, updated_at=excluded.updated_at').run(clean.id, json, revision, time)
      this.db.prepare('INSERT INTO connector_revisions VALUES (?, ?, ?, ?)').run(clean.id, revision, json, time)
      this.db.prepare('DELETE FROM connector_revisions WHERE connector_id=? AND revision NOT IN (SELECT revision FROM connector_revisions WHERE connector_id=? ORDER BY revision DESC LIMIT 20)').run(clean.id, clean.id)
      return revision
    })
  }
  revisions(id: string): { revision: number; definition: ConnectorDefinition }[] {
    return this.db.prepare('SELECT revision, definition FROM connector_revisions WHERE connector_id=? ORDER BY revision DESC').all(id).map(row => ({ revision: Number(row.revision), definition: validateConnector(JSON.parse(String(row.definition))) }))
  }
  secret(name: string): Buffer | undefined { const row = this.db.prepare('SELECT encrypted FROM secrets WHERE name=?').get(name); return row ? Buffer.from(row.encrypted as Uint8Array) : undefined }
  saveSecret(name: string, encrypted?: Buffer) {
    if (encrypted) this.db.prepare('INSERT INTO secrets VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET encrypted=excluded.encrypted').run(name, encrypted)
    else this.db.prepare('DELETE FROM secrets WHERE name=?').run(name)
  }
  saveServices(settings: string, secrets: { id: string; encrypted?: Buffer }[]) {
    this.transaction(() => {
      for (const secret of secrets) this.saveSecret(`service:${secret.id}`, secret.encrypted)
      this.set('services', settings)
    })
  }
  saveModel(settings: string, encrypted?: Buffer) {
    this.transaction(() => { this.saveSecret('model:api-key', encrypted); this.set('model', settings) })
  }
  /** Consistent online SQLite backup, including only OS-encrypted credentials. */
  backup(): string {
    const directory = join(this.directory, 'backups')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `chatos-${Date.now()}-${randomBytes(4).toString('hex')}.sqlite`)
    this.db.prepare('VACUUM INTO ?').run(path)
    chmodSync(path, 0o600)
    // Only prune our own timestamped backups, never arbitrary user files.
    for (const old of readdirSync(directory).filter(name => /^chatos-\d+(?:-[0-9a-f]{8})?\.sqlite$/.test(name)).sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0])).slice(5)) unlinkSync(join(directory, old))
    return path
  }
  close() { this.db.close() }
}
