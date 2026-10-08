import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import type { ConnectorDefinition, OAuthConfiguration } from '../shared/connectors'
import type { Storage } from './storage'
import type { SecretStorage } from './secrets'
import { connectorFetch, checkDestination } from './connector-network'
import type { Confirm } from './connectors'

interface OAuthCredentials { binding: string; accessToken: string; refreshToken?: string; clientSecret?: string; expiresAt?: number }
const binding = (d: ConnectorDefinition) => createHash('sha256').update(JSON.stringify({ baseURL: d.baseURL, auth: d.auth })).digest('hex')

/** PKCE broker. OAuth tokens and optional client secrets never cross renderer IPC. */
export class OAuthBroker {
  private credentials = new Map<string, OAuthCredentials>()
  private refreshes = new Map<string, Promise<string>>()
  private cancellations = new Map<string, () => void>()
  private generation = new Map<string, number>()
  constructor(private store: Storage, private secrets: SecretStorage, private confirm: Confirm, private openExternal: (url: string) => Promise<void>, private fetcher: typeof fetch = connectorFetch) {}
  private load(definition: ConnectorDefinition): OAuthCredentials | undefined {
    let value = this.credentials.get(definition.id)
    if (!value && this.secrets.available()) {
      const encrypted = this.store.secret(`oauth:${definition.id}`)
      if (encrypted) {
        try {
          const saved = JSON.parse(this.secrets.decrypt(encrypted)) as OAuthCredentials
          if (saved && typeof saved.binding === 'string' && typeof saved.accessToken === 'string') { value = saved; this.credentials.set(definition.id, value) }
        } catch { /* Keychain locked or malformed encrypted credential. */ }
      }
    }
    return value?.binding === binding(definition) ? value : undefined
  }
  info(definition: ConnectorDefinition): { hasToken: boolean; tokenStorage: 'encrypted' | 'session' | 'none' } {
    const value = this.load(definition)
    return { hasToken: !!value, tokenStorage: value ? this.secrets.available() && this.store.secret(`oauth:${definition.id}`) ? 'encrypted' : 'session' : 'none' }
  }
  private save(id: string, credentials: OAuthCredentials) {
    this.store.saveSecret(`oauth:${id}`, this.secrets.available() ? this.secrets.encrypt(JSON.stringify(credentials)) : undefined)
    this.credentials.set(id, credentials)
  }
  disconnect(id: string) { this.generation.set(id, (this.generation.get(id) || 0) + 1); this.cancellations.get(id)?.(); this.credentials.delete(id); this.store.saveSecret(`oauth:${id}`) }
  dispose() { for (const [id, cancel] of this.cancellations) { this.generation.set(id, (this.generation.get(id) || 0) + 1); cancel() } }
  async connect(definition: ConnectorDefinition, clientSecret?: string): Promise<void> {
    const config = definition.auth.oauth
    if (definition.auth.type !== 'oauth2' || !config) throw new Error('Configure a registered native OAuth client before signing in')
    if (this.cancellations.has(definition.id)) throw new Error('OAuth sign-in is already pending')
    if (clientSecret !== undefined && (typeof clientSecret !== 'string' || clientSecret.length > 16_384 || /[\r\n\x00]/.test(clientSecret))) throw new Error('Invalid client secret')
    if (!await this.confirm('Authorize OAuth destinations?', `${definition.name}\nSign-in: ${config.authorizationURL}\nToken exchange/refresh: ${config.tokenURL}\nAPI credential destination: ${definition.baseURL}\nClient ID: ${config.clientID}\nScopes: ${config.scopes.join(' ')}\nCallback: http://127.0.0.1:${config.callbackPort || '(dynamic)'}/oauth/callback\n\nUse a registered native app with Authorization Code + PKCE. Tokens are never sent to AI. ${this.secrets.available() ? 'OS-encrypted credentials persist across restarts.' : 'No secure OS store: credentials remain in memory for this run.'}`)) throw new Error('OAuth sign-in cancelled')
    await checkDestination(config.authorizationURL)
    const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url')
    const generation = this.generation.get(definition.id) || 0
    let accept!: (code: string) => void, fail!: (error: Error) => void
    const result = new Promise<string>((resolve, reject) => { accept = resolve; fail = reject })
    // Catch early cancellation until the awaited sign-in stage below.
    void result.catch(() => {})
    let completed = false, timer: ReturnType<typeof setTimeout> | undefined
    const server = createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
      if (request.method !== 'GET' || url.pathname !== '/oauth/callback' || url.searchParams.get('state') !== state || completed) { response.writeHead(400); response.end('Invalid sign-in callback.'); return }
      completed = true
      const code = url.searchParams.get('code')
      if (!code || code.length > 16_384 || url.searchParams.has('error')) { response.writeHead(400); response.end('Sign-in was cancelled or rejected. Return to ChatOS.'); fail(new Error('OAuth authorization was cancelled or rejected')); return }
      response.end('Sign-in received. Return to ChatOS. You can close this page.'); accept(code)
    })
    server.requestTimeout = 10_000; server.headersTimeout = 10_000
    const cancel = () => fail(new Error('OAuth sign-in cancelled'))
    this.cancellations.set(definition.id, cancel)
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.callbackPort || 0, '127.0.0.1', resolve) })
      timer = setTimeout(() => fail(new Error('OAuth sign-in timed out. Try again.')), 120_000)
      const redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}/oauth/callback`
      const authorization = new URL(config.authorizationURL)
      for (const [key, value] of Object.entries({ response_type: 'code', client_id: config.clientID, redirect_uri: redirect, scope: config.scopes.join(' '), state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })) authorization.searchParams.set(key, value)
      if (config.offline) authorization.searchParams.set('access_type', 'offline')
      await this.openExternal(authorization.href)
      const code = await result
      const secret = clientSecret || this.load(definition)?.clientSecret
      const tokens = await this.exchange(config, { grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier }, secret)
      if (generation !== (this.generation.get(definition.id) || 0)) throw new Error('OAuth disconnected during sign-in')
      this.save(definition.id, { binding: binding(definition), ...tokens, ...(secret && { clientSecret: secret }) })
    } finally {
      if (timer) clearTimeout(timer)
      this.cancellations.delete(definition.id); server.closeAllConnections()
      if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
  async token(definition: ConnectorDefinition): Promise<string> {
    const saved = this.load(definition), config = definition.auth.oauth
    if (!saved || !config) throw new Error('Sign in with OAuth in Connections first')
    if (!saved.expiresAt || saved.expiresAt > Date.now() + 30_000) return saved.accessToken
    if (!saved.refreshToken) throw new Error('OAuth access expired. Sign in again; the service supplied no refresh token.')
    const pending = this.refreshes.get(definition.id)
    if (pending) return pending
    const promise = this.exchange(config, { grant_type: 'refresh_token', refresh_token: saved.refreshToken }, saved.clientSecret).then(tokens => {
      // Disconnect/configuration changes must not resurrect credentials.
      if (this.credentials.get(definition.id) !== saved) throw new Error('OAuth credentials changed during refresh')
      this.save(definition.id, { ...saved, ...tokens, refreshToken: tokens.refreshToken || saved.refreshToken })
      return tokens.accessToken
    }).finally(() => this.refreshes.delete(definition.id))
    this.refreshes.set(definition.id, promise)
    return promise
  }
  private async exchange(config: OAuthConfiguration, parameters: Record<string, string>, clientSecret?: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
    const body = new URLSearchParams({ ...parameters, client_id: config.clientID, ...(clientSecret && { client_secret: clientSecret }) })
    let response: Response
    try { response = await this.fetcher(config.tokenURL, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), redirect: 'error', signal: AbortSignal.timeout(15_000) }) }
    catch { throw new Error('OAuth token exchange failed. Check registered client settings and network.') }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`OAuth token exchange rejected (HTTP ${response.status}). Reconnect or check client registration.`) }
    const reader = response.body?.getReader(); if (!reader) throw new Error('OAuth returned an empty response')
    const chunks: Uint8Array[] = []; let bytes = 0
    try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 64_000) throw new Error('OAuth response exceeded 64 KB'); chunks.push(next.value) } }
    finally { await reader.cancel().catch(() => {}) }
    let data: Record<string, unknown>
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('OAuth response was not JSON') }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('OAuth returned an invalid token object')
    if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 16_384 || /[\r\n\x00]/.test(data.access_token) || (data.token_type !== undefined && String(data.token_type).toLowerCase() !== 'bearer')) throw new Error('OAuth needs a valid Bearer access token')
    if (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || data.refresh_token.length > 16_384)) throw new Error('Invalid OAuth refresh token')
    const expires = Number(data.expires_in)
    if (data.expires_in !== undefined && (!Number.isFinite(expires) || expires <= 0)) throw new Error('OAuth supplied an invalid token lifetime')
    return { accessToken: data.access_token, ...(typeof data.refresh_token === 'string' && { refreshToken: data.refresh_token }), ...(Number.isFinite(expires) && expires > 0 && { expiresAt: Date.now() + Math.min(expires, 31_536_000) * 1000 }) }
  }
}
