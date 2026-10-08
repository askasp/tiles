import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { OAuthBroker } from '../src/main/oauth'
import { Storage } from '../src/main/storage'
import { exampleConnector, validateConnector, type ConnectorDefinition } from '../src/shared/connectors'

const stores: Storage[] = [], brokers: OAuthBroker[] = []
const codec = { available: () => true, encrypt: (s: string) => Buffer.from(s.split('').reverse().join('')), decrypt: (b: Buffer) => b.toString().split('').reverse().join('') }
const noSecrets = { ...codec, available: () => false }
const definition = (): ConnectorDefinition => validateConnector({ ...exampleConnector, baseURL: 'http://127.0.0.1:9876', auth: { type: 'oauth2', oauth: { clientID: 'registered-native-client', authorizationURL: 'http://127.0.0.1:9876/authorize', tokenURL: 'http://127.0.0.1:9876/token', scopes: ['tickets:read'], offline: true } } })
afterEach(() => { vi.restoreAllMocks(); for (const broker of brokers.splice(0)) broker.dispose(); for (const store of stores.splice(0)) { store.close(); rmSync(store.directory, { recursive: true, force: true }) } })

function setup(secure = true) {
  const store = new Storage(mkdtempSync('/tmp/opencode/chatos-oauth-')); stores.push(store)
  const exchanges: URLSearchParams[] = [], opened: URL[] = []
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body)); exchanges.push(body)
    return new Response(JSON.stringify(body.get('grant_type') === 'refresh_token' ? { access_token: 'new-private-access-token', refresh_token: 'rotated-private-refresh', expires_in: 3600, token_type: 'Bearer' } : { access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 60, token_type: 'Bearer' }))
  })
  const open = async (raw: string) => {
    const url = new URL(raw); opened.push(url)
    const callback = new URL(url.searchParams.get('redirect_uri')!)
    callback.searchParams.set('state', 'wrong-state'); callback.searchParams.set('code', 'fake-code')
    expect((await fetch(callback)).status).toBe(400)
    callback.searchParams.set('state', url.searchParams.get('state')!)
    expect((await fetch(callback)).status).toBe(200)
  }
  const confirm = vi.fn(async (_title: string, _detail: string) => true)
  const broker = new OAuthBroker(store, secure ? codec : noSecrets, confirm, open, fetcher); brokers.push(broker)
  return { store, broker, opened, exchanges, fetcher, confirm }
}
describe('native OAuth PKCE broker', () => {
  it('validates registered client/scopes and refuses arbitrary grant flows or credential-bearing URLs', () => {
    const d = definition(); expect(d.auth.oauth?.scopes).toEqual(['tickets:read'])
    expect(() => validateConnector({ ...d, auth: { type: 'oauth2', oauth: { ...d.auth.oauth, tokenURL: 'http://remote.test/token' } } })).toThrow('HTTPS')
    expect(() => validateConnector({ ...d, auth: { type: 'oauth2', oauth: { ...d.auth.oauth, grant: 'password' } } })).toThrow(/unsupported field/i)
    expect(() => validateConnector({ ...d, auth: { type: 'oauth2', oauth: { ...d.auth.oauth, scopes: ['read write'] } } })).toThrow('scopes')
  })
  it('uses state, PKCE and loopback; only encrypted credentials survive a broker restart', async () => {
    const { store, broker, opened, exchanges } = setup()
    await broker.connect(definition(), 'private-client-secret')
    const params = exchanges[0], url = opened[0]
    expect(params.get('grant_type')).toBe('authorization_code'); expect(params.get('client_secret')).toBe('private-client-secret')
    expect(createHash('sha256').update(params.get('code_verifier')!).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(url.searchParams.get('access_type')).toBe('offline')
    expect(params.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/)
    expect(broker.info(definition())).toEqual({ hasToken: true, tokenStorage: 'encrypted' })
    expect(JSON.stringify(broker.info(definition()))).not.toContain('private-access-token')
    expect(readFileSync(store.backup()).includes(Buffer.from('private-refresh-token'))).toBe(false)
    const restored = new OAuthBroker(store, codec, async () => true, async () => {}); brokers.push(restored)
    expect(await restored.token(definition())).toBe('private-access-token')
    await expect(restored.token({ ...definition(), baseURL: 'http://127.0.0.1:9877' })).rejects.toThrow('Sign in')
    broker.disconnect(definition().id); expect(store.secret('oauth:helpdesk')).toBeUndefined()
  })
  it('serializes refreshes, rotates refresh tokens and preserves the registered token destination', async () => {
    const { broker, exchanges } = setup()
    await broker.connect(definition())
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    expect(await Promise.all([broker.token(definition()), broker.token(definition())])).toEqual(['new-private-access-token', 'new-private-access-token'])
    expect(exchanges).toHaveLength(2)
    expect(exchanges[1].get('refresh_token')).toBe('private-refresh-token')
    expect(exchanges[1].get('client_id')).toBe('registered-native-client')
  })
  it('keeps auth session-only without an OS store and never opens a cancelled sign-in', async () => {
    const { store, broker, opened, confirm } = setup(false)
    confirm.mockResolvedValueOnce(false)
    await expect(broker.connect(definition())).rejects.toThrow('cancelled'); expect(opened).toEqual([])
    await broker.connect(definition())
    expect(broker.info(definition()).tokenStorage).toBe('session'); expect(store.secret('oauth:helpdesk')).toBeUndefined()
  })
  it('does not resurrect credentials when disconnected during a refresh', async () => {
    const { broker, fetcher, store } = setup()
    await broker.connect(definition())
    const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    let finish!: (response: Response) => void
    fetcher.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
    const refreshing = broker.token(definition())
    broker.disconnect(definition().id)
    finish(new Response('{"access_token":"must-not-resurrect","expires_in":3600}'))
    await expect(refreshing).rejects.toThrow('changed during refresh')
    expect(store.secret('oauth:helpdesk')).toBeUndefined(); expect(broker.info(definition()).hasToken).toBe(false)
  })
})
