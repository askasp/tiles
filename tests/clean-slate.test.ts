import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { Storage } from '../src/main/storage'
import { ModelBroker } from '../src/main/model'
import { Files } from '../src/main/files'
import { Terminals } from '../src/main/terminal'
import { addIntent, builtinSources, modelIntent, terminalIntent } from '../src/shared/sources'
import { desktopInitial, openTile, restoreDesktop, serializeDesktop, terminalTile } from '../src/shared/tiles'
import { exampleConnector } from '../src/shared/connectors'
import type { DesktopEvent } from '../src/shared/types'

const directories: string[] = [], stores: Storage[] = []
const codec = { available: () => true, encrypt: (s: string) => Buffer.from(s.split('').reverse().join('')), decrypt: (b: Buffer) => b.toString().split('').reverse().join('') }
const temp = (prefix: string) => { const d = mkdtempSync(`/tmp/opencode/${prefix}`); directories.push(d); return d }
function store() { const s = new Storage(temp('chatos-clean-db-')); stores.push(s); return s }
const json = (data: unknown, status = 200, type = 'application/json') => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers: { 'Content-Type': type } })
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of directories.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('clean-slate sources', () => {
  it('ships only Browser, Files and Terminal; everything else is added by asking', () => {
    expect(builtinSources).toEqual(['web', 'files', 'terminal'])
    expect(addIntent('add opencode')).toEqual({ name: 'opencode', known: 'opencode' })
    expect(addIntent('Connect my Front account')).toEqual({ name: 'Front', known: 'front' })
    expect(addIntent('set up linear')).toEqual({ name: 'linear', known: undefined })
    expect(addIntent('add a model')).toBeUndefined()
    expect(addIntent('chatos')).toBeUndefined()
    expect(modelIntent('model')).toBe(true)
    expect(modelIntent('change model')).toBe(true)
    expect(terminalIntent('terminal')?.[1]).toBeUndefined()
    expect(terminalIntent('terminal in /tmp')?.[1]).toBe('/tmp')
    expect(terminalIntent('terminal velocity')).toBeNull()
  })
  it('terminal tiles are unique per shell and survive restart as resources, not processes', () => {
    const a = terminalTile('/home/me/chatos'), b = terminalTile('/home/me/chatos')
    expect(a.key).not.toBe(b.key)
    const s = openTile(openTile(desktopInitial(), a), b)
    const restored = restoreDesktop(serializeDesktop(s))
    expect(restored.tiles.filter(t => t.kind === 'terminal').map(t => t.directory)).toEqual(['/home/me/chatos', '/home/me/chatos'])
    expect(() => terminalTile('relative/path')).toThrow()
  })
})

describe('independent model for K', () => {
  const allow = async () => true
  it('first launch can be skipped and the choice persists', () => {
    const db = store()
    expect(new ModelBroker(db, codec, allow).info()).toMatchObject({ configured: false, ready: false, skipped: false })
    new ModelBroker(db, codec, allow).skip()
    expect(new ModelBroker(db, codec, allow).info().skipped).toBe(true)
  })
  it('probes the model list with the pasted key, never returns it, and a local endpoint needs none', async () => {
    const seen: { url: string; auth?: string | null }[] = []
    const fetcher = (async (url: string, init?: RequestInit) => { seen.push({ url, auth: new Headers(init?.headers).get('authorization') }); return url.includes('bad') ? json({}, 401) : json({ data: [{ id: 'gpt-x' }, { id: 'text-embedding-3' }, { id: 'gpt-x' }] }) }) as typeof fetch
    const broker = new ModelBroker(store(), codec, allow, fetcher, async () => {})
    const probe = await broker.probe({ baseURL: 'https://api.example.com/v1/', apiKey: 'sk-secret' })
    expect(probe).toEqual({ baseURL: 'https://api.example.com/v1', models: ['gpt-x', 'text-embedding-3'] })
    expect(JSON.stringify(probe)).not.toContain('sk-secret')
    expect(seen[0]).toEqual({ url: 'https://api.example.com/v1/models', auth: 'Bearer sk-secret' })
    await expect(broker.probe({ baseURL: 'https://bad.example.com/v1', apiKey: 'sk' })).rejects.toThrow('rejected this API key')
    await expect(broker.probe({ baseURL: 'https://api.example.com/v1' })).rejects.toThrow('Paste an API key')
    await broker.probe({ baseURL: 'http://localhost:11434/v1' })
    expect(seen.at(-1)).toEqual({ url: 'http://localhost:11434/v1/models', auth: null })
  })
  it('saves only after approval, and a local model is ready without a key', async () => {
    const db = store()
    const denied = new ModelBroker(db, codec, async () => false, (async () => json({})) as typeof fetch, async () => {})
    await expect(denied.save({ baseURL: 'http://localhost:11434/v1', model: 'llama' })).rejects.toThrow('cancelled')
    expect(denied.info().configured).toBe(false)
    const broker = new ModelBroker(db, codec, allow, (async () => json({})) as typeof fetch, async () => {})
    expect(await broker.save({ baseURL: 'http://localhost:11434/v1', model: 'llama' })).toMatchObject({ ready: true, local: true, tokenStorage: 'none' })
    expect(new ModelBroker(db, codec, allow).info()).toMatchObject({ ready: true, model: 'llama' })
  })
  it('reads linked public docs as inert data and returns a validated connector proposal', async () => {
    const db = store(), prompts: string[] = []
    const definition = { ...exampleConnector, baseURL: 'https://api.helpdesk.example' }
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (url === 'https://docs.helpdesk.example/api') return json('<html><nav>menu</nav><h1>Tickets</h1><p>GET /tickets</p><script>steal()</script></html>', 200, 'text/html')
      prompts.push(JSON.parse(String(init?.body)).messages[0].content)
      return json({ choices: [{ message: { content: JSON.stringify({ kind: 'connector', text: 'Helpdesk tickets.', definition }) } }] })
    }) as typeof fetch
    const broker = new ModelBroker(db, codec, allow, fetcher, async () => {})
    await broker.save({ baseURL: 'http://localhost:11434/v1', model: 'llama' })
    const result = await broker.discover([{ role: 'user', text: 'add helpdesk' }, { role: 'k', text: 'Link the API docs?' }, { role: 'user', text: 'https://docs.helpdesk.example/api' }])
    expect(result.kind).toBe('connector')
    expect(result.read).toEqual(['https://docs.helpdesk.example/api'])
    expect(prompts[0]).toContain('GET /tickets')
    expect(prompts[0]).not.toContain('steal()')
    expect(prompts[0]).not.toContain('menu')
  })
  it('a non-JSON model answer becomes a plain reply, and OpenCode URLs must come from the user', async () => {
    let answer = 'Which API do you mean?'
    const broker = new ModelBroker(store(), codec, allow, (async () => json({ choices: [{ message: { content: answer } }] })) as typeof fetch, async () => {})
    await broker.save({ baseURL: 'http://localhost:11434/v1', model: 'llama' })
    expect(await broker.discover([{ role: 'user', text: 'add thing' }])).toEqual({ kind: 'answer', text: 'Which API do you mean?', read: [] })
    answer = JSON.stringify({ kind: 'opencode', text: 'Connect', url: 'http://127.0.0.1:9999' })
    await expect(broker.discover([{ role: 'user', text: 'add opencode' }])).rejects.toThrow('invented the server URL')
  })
})

describe('built-in Files and Terminal', () => {
  it('finds folders and files by name in a bounded walk of home, skipping hidden and dependency folders', async () => {
    const home = temp('chatos-home-')
    for (const dir of ['code/chatos', 'code/chatos-docs', '.cache/chatos', 'code/app/node_modules/chatos', 'notes']) mkdirSync(`${home}/${dir}`, { recursive: true })
    writeFileSync(`${home}/notes/chatos.md`, 'plan')
    const files = new Files('linux')
    const found = await files.findPaths('chatos', home)
    expect(found.map(f => [f.kind, f.path])).toEqual([['folder', `${home}/code/chatos`], ['file', `${home}/notes/chatos.md`], ['folder', `${home}/code/chatos-docs`]])
    expect(await files.findPaths('c', home)).toEqual([])
  })
  it.skipIf(process.platform === 'win32')('runs a real pty shell in the requested folder, resizes it and ends it on close', async () => {
    const cwd = temp('chatos-term-'), events: DesktopEvent[] = []
    const terminals = new Terminals(e => events.push(e))
    const output = () => events.filter((e): e is Extract<DesktopEvent, { type: 'terminal' }> => e.type === 'terminal').map(e => e.data).join('')
    const until = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 50)); expect(check()).toBe(true) }
    try {
      terminals.open({ id: 't1', cwd, cols: 80, rows: 24 })
      await new Promise(r => setTimeout(r, 400))
      terminals.input('t1', 'echo "at=$(pwd) tty=$([ -t 0 ] && echo yes)"\n')
      await until(() => output().includes(`at=${cwd} tty=yes`))
      terminals.resize('t1', 120, 40)
      await new Promise(r => setTimeout(r, 200))
      terminals.input('t1', 'stty size\n')
      await until(() => output().includes('40 120'))
      expect(terminals.open({ id: 't1', cwd, cols: 80, rows: 24 }).replay).toContain(`at=${cwd}`)
      terminals.close('t1')
      await until(() => events.some(e => e.type === 'terminal-exit' && e.id === 't1'))
    } finally { terminals.dispose() }
  })
})
