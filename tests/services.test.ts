import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { Services, serviceURL } from '../src/main/services'

describe('service settings security', () => {
  it('rejects wrong service hosts, embedded credentials, and non-https URLs', () => {
    for (const url of ['http://app.slack.com', 'https://slack.com.evil.test/', 'https://a:b@app.slack.com', 'file:///secret']) expect(() => serviceURL('slack', url)).toThrow()
    expect(serviceURL('slack', 'https://team.slack.com')).toBe('https://team.slack.com/')
    expect(() => serviceURL('toString' as 'slack', 'https://github.com')).toThrow('Unknown service')
  })
  it('stores ciphertext only and never returns the token to the renderer', async () => {
    const directory = await mkdtemp('/tmp/opencode/chatos-auth-')
    const codec = { available: () => true, encrypt: (s: string) => Buffer.from(s.split('').reverse().join('')), decrypt: (b: Buffer) => b.toString().split('').reverse().join('') }
    try {
      const auth = new Services(directory, codec)
      const info = await auth.save({ id: 'slack', token: 'sensitive-test-token' })
      expect(info.hasToken).toBe(true); expect(info.tokenStorage).toBe('encrypted')
      expect(JSON.stringify(info)).not.toContain('sensitive-test-token')
      expect(await readFile(`${directory}/services.json`, 'utf8')).not.toContain('sensitive-test-token')
      expect((await new Services(directory, codec).list())[0].hasToken).toBe(true)
      await auth.disconnect('slack')
      expect((await auth.list())[0].hasToken).toBe(false)
      expect(await readFile(`${directory}/services.json`, 'utf8')).not.toContain('encryptedToken')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('keeps tokens only in memory when secure storage is unavailable', async () => {
    const directory = await mkdtemp('/tmp/opencode/chatos-auth-')
    const codec = { available: () => false, encrypt: () => { throw new Error('Must never call') }, decrypt: () => { throw new Error('Must never call') } }
    const seen: { url: string; authorization: string; redirect?: RequestRedirect }[] = []
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') || '', redirect: init?.redirect }); return new Response(JSON.stringify({ login: 'test-user' }), { status: 200 }) }
    try {
      const auth = new Services(directory, codec, fetcher as typeof fetch)
      const info = await auth.save({ id: 'github', token: 'session-only-secret' })
      expect(info.tokenStorage).toBe('session')
      expect(await readFile(`${directory}/services.json`, 'utf8')).not.toContain('session-only-secret')
      expect((await new Services(directory, codec).list()).find(s => s.id === 'github')?.hasToken).toBe(false)
      expect(await auth.validate('github')).toEqual({ ok: true, account: 'test-user' })
      expect(seen).toEqual([{ url: 'https://api.github.com/user', authorization: 'Bearer session-only-secret', redirect: 'error' }])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('persists nonsecret Front filter identity separately from tokens', async () => {
    const directory = await mkdtemp('/tmp/opencode/chatos-front-settings-')
    const codec = { available: () => false, encrypt: () => { throw new Error('Must never call') }, decrypt: () => { throw new Error('Must never call') } }
    try {
      const auth = new Services(directory, codec)
      const identity = { email: 'me@example.test', teammateID: 'tea_123', tagID: 'tag_abc' }
      await auth.save({ id: 'front', token: 'front-private', front: identity })
      const restored = (await new Services(directory, codec).list()).find(s => s.id === 'front')!
      expect(restored.front).toEqual(identity); expect(restored.hasToken).toBe(false)
      expect(await readFile(`${directory}/services.json`, 'utf8')).not.toContain('front-private')
      await auth.disconnect('front'); expect((await auth.list()).find(s => s.id === 'front')?.front).toEqual(identity)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
