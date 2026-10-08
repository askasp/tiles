import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FrontIdentity, ServiceID, ServiceInfo } from '../shared/types'
import { ProviderSearch } from './provider-search'
import { frontIdentity } from '../shared/front'
import type { Storage } from './storage'

export interface SecretStorage {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}
export const serviceDefaults = {
  slack: { name: 'Slack', url: 'https://app.slack.com/' },
  front: { name: 'Front', url: 'https://app.frontapp.com/' },
  github: { name: 'GitHub', url: 'https://github.com/pulls/review-requested' },
} as const
interface SavedService { url: string; encryptedToken?: string; front?: FrontIdentity }

export function serviceURL(id: ServiceID, value: string) {
  if (!Object.hasOwn(serviceDefaults, id)) throw new Error('Unknown service')
  const url = new URL(value)
  const host = url.hostname
  const allowed = id === 'slack' ? host === 'slack.com' || host.endsWith('.slack.com') : id === 'front' ? ['frontapp.com', 'front.com'].some(domain => host === domain || host.endsWith(`.${domain}`)) : host === 'github.com'
  if (!allowed || url.protocol !== 'https:' || url.username || url.password) throw new Error(`Use a normal HTTPS ${serviceDefaults[id].name} URL, without credentials.`)
  return url.href
}

/** Tokens never leave the main process. Persistence requires real OS encryption. */
export class Services {
  private saved: Partial<Record<ServiceID, SavedService>> = {}
  private tokens = new Map<ServiceID, string>()
  private accounts = new Map<ServiceID, string>()
  private disk = new Set<ServiceID>()
  private ready: Promise<void>
  private writes: Promise<void> = Promise.resolve()
  private searcher: ProviderSearch
  private writing = new Set<string>()
  constructor(private directory: string, private secrets: SecretStorage, private fetcher: typeof fetch = fetch, private storage?: Storage, private confirm: (title: string, detail: string) => Promise<boolean> = async () => false) {
    this.ready = this.load()
    this.searcher = new ProviderSearch(id => this.tokens.get(id), fetcher)
  }
  private async load() {
    try {
      const saved = this.storage?.get('services')
      const parsed = JSON.parse(saved || await readFile(join(this.directory, 'services.json'), 'utf8'))
      for (const id of Object.keys(serviceDefaults) as ServiceID[]) {
        if (!parsed[id]) continue
        let url: string
        try { url = serviceURL(id, parsed[id].url) } catch { url = serviceDefaults[id].url }
        const encryptedToken = this.storage?.secret(`service:${id}`)?.toString('base64') || (typeof parsed[id].encryptedToken === 'string' ? parsed[id].encryptedToken : undefined)
        let front: FrontIdentity | undefined
        if (id === 'front') { try { front = frontIdentity(parsed[id].front) } catch { /* Ignore malformed nonsecret filter identity. */ } }
        this.saved[id] = { url, encryptedToken, front }
        if (encryptedToken && this.secrets.available()) {
          try { this.tokens.set(id, this.secrets.decrypt(Buffer.from(encryptedToken, 'base64'))); this.disk.add(id) } catch { /* Locked keychain: never expose or log secret data. */ }
        }
      }
      if (this.storage && !saved) await this.persist()
    } catch { /* First run or damaged settings: start with safe defaults. */ }
  }
  private info(id: ServiceID): ServiceInfo {
    if (!Object.hasOwn(serviceDefaults, id)) throw new Error('Unknown service')
    return { id, name: serviceDefaults[id].name, configured: Boolean(this.saved[id]), url: this.saved[id]?.url || serviceDefaults[id].url, hasToken: this.tokens.has(id), tokenStorage: this.tokens.has(id) ? this.disk.has(id) ? 'encrypted' : 'session' : 'none', secureStorage: this.secrets.available(), account: this.accounts.get(id), ...(id === 'front' && { front: this.saved[id]?.front || frontIdentity() }) }
  }
  async list() { await this.ready; return (Object.keys(serviceDefaults) as ServiceID[]).map(id => this.info(id)) }
  async search(query: string) { await this.ready; return this.searcher.search(query) }
  async frontList(input: { query: string; cursor?: string }) { await this.ready; return this.searcher.frontList(input) }
  async frontDetail(input: { id: string; cursor?: string }) { await this.ready; return this.searcher.frontDetail(input) }
  private persist() {
    if (this.storage) {
      this.storage.saveServices(JSON.stringify(Object.fromEntries(Object.entries(this.saved).map(([id, value]) => [id, { url: value.url, front: value.front }]))), (Object.keys(serviceDefaults) as ServiceID[]).map(id => ({ id, encrypted: this.saved[id]?.encryptedToken ? Buffer.from(this.saved[id]!.encryptedToken!, 'base64') : undefined })))
      return Promise.resolve()
    }
    const content = JSON.stringify(this.saved, null, 2)
    const operation = this.writes.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true })
      const path = join(this.directory, 'services.json'), temporary = `${path}.next`
      await writeFile(temporary, content, { mode: 0o600 }); await rename(temporary, path)
    })
    this.writes = operation
    return operation
  }
  async save(input: { id: ServiceID; url?: string; token?: string; front?: FrontIdentity }) {
    await this.ready
    const { id } = input
    if (!Object.hasOwn(serviceDefaults, id)) throw new Error('Unknown service')
    const url = serviceURL(id, input.url || this.saved[id]?.url || serviceDefaults[id].url)
    const token = input.token?.trim()
    if (token && (token.length > 16_384 || /[\r\n\x00]/.test(token))) throw new Error('Invalid token format')
    const saved = { ...this.saved[id], url }
    if (input.front !== undefined) { if (id !== 'front') throw new Error('Front filter identity applies only to Front'); saved.front = frontIdentity(input.front) }
    if (token) {
      // Never use safeStorage's Linux basic_text fallback as "encryption".
      if (this.secrets.available()) { saved.encryptedToken = this.secrets.encrypt(token).toString('base64') }
      else { delete saved.encryptedToken; this.disk.delete(id) }
      this.tokens.set(id, token); this.accounts.delete(id)
      this.searcher.invalidate(id)
    }
    this.saved[id] = saved
    try { await this.persist(); if (saved.encryptedToken && this.tokens.has(id)) this.disk.add(id) }
    catch { this.disk.delete(id); throw new Error('Could not save service settings. The token is available only for this run.') }
    return this.info(id)
  }
  async disconnect(id: ServiceID) {
    await this.ready
    if (!Object.hasOwn(serviceDefaults, id)) throw new Error('Unknown service')
    this.tokens.delete(id); this.disk.delete(id); this.accounts.delete(id)
    this.searcher.invalidate(id)
    this.saved[id] = { url: this.saved[id]?.url || serviceDefaults[id].url, front: this.saved[id]?.front }
    await this.persist()
  }
  /** Remove the service as a source: token, account and saved settings. Browser cookies are separate. */
  async remove(id: ServiceID) {
    await this.ready
    if (!Object.hasOwn(serviceDefaults, id)) throw new Error('Unknown service')
    this.tokens.delete(id); this.disk.delete(id); this.accounts.delete(id)
    this.searcher.invalidate(id)
    delete this.saved[id]
    await this.persist()
  }
  /** Reply to a Front conversation, or add an internal comment. Always asks first with the exact text; never retried. */
  async frontWrite(input: { id: string; kind: 'reply' | 'comment'; body: string }): Promise<void> {
    await this.ready
    if (!input || typeof input.id !== 'string' || !/^cnv_[a-z0-9]+$/i.test(input.id)) throw new Error('Invalid Front conversation ID')
    if (input.kind !== 'reply' && input.kind !== 'comment') throw new Error('Unknown Front action')
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (!body || body.length > 50_000) throw new Error('Write a message first (under 50,000 characters).')
    const token = this.tokens.get('front')
    if (!token) throw new Error('Add Front first: Super+K → add front.')
    if (this.writing.has(input.id)) throw new Error('A Front action for this conversation is already pending.')
    this.writing.add(input.id)
    try {
      const author = this.saved.front?.front?.teammateID
      const path = input.kind === 'reply' ? 'messages' : 'comments'
      const url = `https://api2.frontapp.com/conversations/${input.id}/${path}`
      const payload = JSON.stringify({ body, ...(author && { author_id: author }) })
      const verb = input.kind === 'reply' ? 'Send this reply to the customer?' : 'Add this internal comment?'
      if (!await this.confirm(verb, `${input.kind === 'reply' ? 'Visible to the people on this conversation.' : 'Visible to your team only.'}\nPOST ${url}\n\n${body}`)) throw new Error('Cancelled. Nothing was sent; your draft is kept.')
      let response: Response
      try { response = await this.fetcher(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'ChatOS/0.2' }, body: payload, redirect: 'error', signal: AbortSignal.timeout(20_000) }) }
      catch { throw new Error('Front could not be reached, so it is unknown whether this was sent. Check the conversation in Front before trying again.') }
      if (response.status === 401 || response.status === 403) throw new Error(`Front refused this (HTTP ${response.status}). The token needs ${input.kind === 'reply' ? 'messages:send' : 'comments:write'} access.`)
      if (!response.ok) throw new Error(`Front answered HTTP ${response.status}. Nothing is retried automatically; check the conversation before trying again.`)
      this.searcher.invalidate('front')
    } finally { this.writing.delete(input.id) }
  }
  async validate(id: ServiceID): Promise<{ ok: boolean; account?: string; error?: string }> {
    await this.ready
    if (!Object.hasOwn(serviceDefaults, id)) throw new Error('Unknown service')
    const token = this.tokens.get(id)
    if (!token) return { ok: false, error: 'No API token saved. Browser sign-in works independently.' }
    const endpoint = id === 'slack' ? 'https://slack.com/api/auth.test' : id === 'front' ? 'https://api2.frontapp.com/me' : 'https://api.github.com/user'
    try {
      const response = await this.fetcher(endpoint, { method: id === 'slack' ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'ChatOS/0.2' }, redirect: 'error', signal: AbortSignal.timeout(12_000) })
      if (!response.ok) return { ok: false, error: `Token verification failed (HTTP ${response.status}). Check token scopes and expiry.` }
      const result = await response.json() as Record<string, unknown>
      if (id === 'slack' && result.ok !== true) return { ok: false, error: 'Slack rejected this token. Check token type, scopes, and expiry.' }
      const account = String(result.login || result.user || result.username || result.email || result.name || 'Verified account').slice(0, 160)
      this.accounts.set(id, account)
      return { ok: true, account }
    } catch { return { ok: false, error: 'Could not verify the token. Check connectivity and retry.' } }
  }
}
