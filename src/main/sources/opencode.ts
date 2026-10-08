import { OpenCode, type OpenCodeClient } from '@opencode/client'
import { Service } from '@opencode/client/service'
import { setTimeout as delay } from 'node:timers/promises'
import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'
import type {
  ConnectionInfo, MessageInfo, MessagePage, OpenCodeAPI, OpenCodeEvent,
  OpenCodeProbe, SessionDetail, SessionInfo, SessionPage, Snapshot,
} from '../../shared/sources/opencode/types'
import type { MainContext, MainSource } from '../registry'

/** Remembered OpenCode source. Absent means OpenCode is not a source. */
export interface OpenCodeSettingsStore {
  load(): { url?: string; token?: string } | undefined
  save(settings: { url?: string; token?: string } | undefined): void
}

/** Finds an installed OpenCode 2 CLI without starting anything. */
export async function findOpenCode(env = process.env): Promise<{ path: string; version: string } | undefined> {
  const dirs = [...(env.PATH || '').split(delimiter), join(homedir(), '.opencode', 'bin'), join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'].filter(Boolean)
  for (const name of ['opencode2', 'opencode']) {
    for (const dir of [...new Set(dirs)]) {
      const path = join(dir, name)
      try { await access(path, constants.X_OK) } catch { continue }
      const version = await new Promise<string>(resolve => execFile(path, ['--version'], { timeout: 4_000, env: { ...env, NO_COLOR: '1' } }, (error, stdout) => resolve(error ? '' : stdout.trim())))
      const match = version.match(/(\d+\.\d+\.\d+)/)
      if (match?.[1].startsWith('2.')) return { path, version: match[1] }
    }
  }
}

const timeout = () => ({ signal: AbortSignal.timeout(20_000) })
const textLimit = (text: string, max = 60_000) => text.length > max ? `${text.slice(0, max)}\n… (output truncated in ChatOS)` : text

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return typeof error === 'string' ? error : 'The request failed. Check the OpenCode server connection.'
}

function messagesForUI(page: Awaited<ReturnType<OpenCodeClient['message']['list']>>): MessagePage {
  return {
    cursor: page.cursor,
    data: page.data.map(message => {
      const result: MessageInfo = { id: message.id, type: message.type, time: message.time }
      if ('text' in message) result.text = message.text
      if ('description' in message) result.description = message.description
      if ('agent' in message) result.agent = message.agent
      if ('model' in message) result.model = message.model
      if ('files' in message) result.files = message.files?.map(file => ({ name: file.name, mime: file.mime }))
      if ('error' in message) result.error = message.error
      if ('finish' in message) result.finish = message.finish
      if (message.type === 'assistant') {
        result.content = message.content.map(part => {
          if (part.type !== 'tool') return { type: part.type, text: part.text }
          const { state } = part
          return {
            type: 'tool', id: part.id, name: part.name, time: part.time,
            state: {
              status: state.status,
              ...('input' in state && { input: typeof state.input === 'string' ? { streaming: state.input } : state.input }),
              ...('error' in state && { error: errorMessage(state.error) }),
              ...('content' in state && {
                content: (state.content || []).map(content => content.type === 'text'
                  ? { type: 'text' as const, text: textLimit(content.text) }
                  : { type: 'file' as const, name: content.name }),
              }),
            },
          }
        })
      }
      if (message.type === 'shell') result.text = `$ ${message.command}\n${message.output || ''}`
      return result
    }),
  }
}

export class OpenCodeBridge {
  private client?: OpenCodeClient
  private stream?: AbortController
  private disposed = false
  private generation = 0
  private connecting?: Promise<ConnectionInfo>
  private settings: { url?: string; token?: string }
  private activated: boolean
  connection: ConnectionInfo = { connected: false, automatic: true, enabled: false }

  constructor(
    private readonly emit: (event: OpenCodeEvent) => void,
    readonly directory: string,
    settings: { url?: string; token?: string } = {},
    private readonly store?: OpenCodeSettingsStore,
  ) {
    const saved = settings.url ? undefined : store?.load()
    this.settings = saved || settings
    this.activated = Boolean(settings.url || saved)
    this.connection = { ...this.connection, enabled: this.activated, automatic: !this.settings.url }
  }

  private updateConnection(patch: Partial<ConnectionInfo>) {
    this.connection = { ...this.connection, ...patch }
    this.emit({ type: 'connection', connection: this.connection })
  }

  /** What “add opencode” can offer, without connecting or starting anything. */
  async probe(): Promise<OpenCodeProbe> {
    const [binary, running] = await Promise.all([findOpenCode(), Service.discover().catch(() => undefined)])
    return { binary: binary?.path, version: binary?.version, running: running?.url, connection: this.connection }
  }

  /** Starts the shared OpenCode background service (the same one the CLI uses), then connects. */
  async start(): Promise<ConnectionInfo> {
    const binary = await findOpenCode()
    if (!binary) throw new Error('OpenCode 2 is not installed. Install it from opencode.ai, then try again.')
    await Service.ensure({ command: [binary.path, 'serve', '--service'] })
    return this.connect({})
  }

  /** Forget OpenCode as a source. The OpenCode service itself keeps running. */
  disconnect(): ConnectionInfo {
    this.generation++
    this.stream?.abort()
    this.client = undefined
    this.activated = false
    this.settings = {}
    this.store?.save(undefined)
    this.connection = { connected: false, automatic: true, enabled: false }
    this.emit({ type: 'connection', connection: this.connection })
    return this.connection
  }

  connect(settings?: { url?: string; token?: string }): Promise<ConnectionInfo> {
    this.activated = true
    if (this.connecting && !settings) return this.connecting
    if (settings) this.settings = settings
    const generation = ++this.generation
    this.stream?.abort()
    this.client = undefined
    this.connecting = this.connectOnce(generation).finally(() => { this.connecting = undefined })
    return this.connecting
  }

  private async connectOnce(generation: number): Promise<ConnectionInfo> {
    const automatic = !this.settings.url
    this.updateConnection({ connected: false, automatic, enabled: true, error: undefined, streaming: false })
    try {
      let url = this.settings.url
      let headers: Record<string, string> = {}
      if (!url) {
        const endpoint = await Service.discover()
        if (!endpoint) throw new Error('No running OpenCode 2 service found. Start it from Super+K → “add opencode”, or enter a server URL.')
        url = endpoint.url
        headers = Service.headers(endpoint) || {}
      } else {
        const parsed = new URL(url)
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
          throw new Error('Use an HTTP(S) server URL without embedded credentials.')
        }
        if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
          throw new Error('Remote servers require HTTPS so credentials and prompts are encrypted.')
        }
        url = parsed.href.replace(/\/$/, '')
        // OpenCode servers use Basic auth with the fixed username "opencode" (OPENCODE_SERVER_PASSWORD).
        if (this.settings.token) headers.authorization = `Basic ${Buffer.from(`opencode:${this.settings.token}`).toString('base64')}`
      }
      const client = OpenCode.make({ baseUrl: url, headers })
      const info = await client.server.info(timeout())
      if (!info.version.startsWith('2.')) throw new Error(`This app needs OpenCode 2; the server reports ${info.version}.`)
      if (generation !== this.generation || this.disposed) return this.connection
      this.client = client
      // Remember the source only once it actually connected.
      this.store?.save(automatic ? {} : { url, ...(this.settings.token && { token: this.settings.token }) })
      this.updateConnection({ connected: true, url, version: info.version, automatic, error: undefined })
      this.stream = new AbortController()
      void this.consumeEvents(client, generation, this.stream.signal)
    } catch (error) {
      if (generation === this.generation) this.updateConnection({ connected: false, error: errorMessage(error), automatic })
    }
    return this.connection
  }

  private async consumeEvents(client: OpenCodeClient, generation: number, signal: AbortSignal) {
    let failures = 0
    while (!signal.aborted && !this.disposed && generation === this.generation) {
      try {
        for await (const event of client.event.subscribe({ signal })) {
          failures = 0
          if (event.type === 'server.connected') {
            this.updateConnection({ connected: true, streaming: true, error: undefined })
          } else if (/^(session\.|permission\.|form\.|project\.|vcs\.|filesystem\.)/.test(event.type)) {
            // The renderer needs invalidation signals, not every session's
            // token/provider state or potentially huge tool output over IPC.
            const data = event.data as Record<string, unknown>
            this.emit({ type: 'server', event: {
              id: event.id, type: event.type,
              data: {
                ...(typeof data.sessionID === 'string' && { sessionID: data.sessionID }),
                ...(typeof data.title === 'string' && { title: data.title }),
              },
            } })
          }
        }
        if (signal.aborted) break
        throw new Error('Event connection closed')
      } catch (error) {
        if (signal.aborted || generation !== this.generation) break
        this.updateConnection({ streaming: false, error: 'Live updates disconnected. Reconnecting…' })
        try { await delay(Math.min(1_000 * 2 ** failures++, 10_000), undefined, { signal }) } catch { break }
        if (this.connection.automatic) {
          try {
            const endpoint = await Service.discover()
            if (endpoint && endpoint.url !== this.connection.url) {
              void this.connect()
              return
            }
          } catch { /* Try the same endpoint again. */ }
        }
      }
    }
  }

  private ready(): OpenCodeClient {
    if (!this.client) throw new Error(this.connection.error || 'Not connected to OpenCode. Open Connection settings to reconnect.')
    return this.client
  }

  async bootstrap(home: string, platform: string): Promise<Snapshot> {
    // First run is source-neutral. Discovery is an explicit Connect action.
    if (!this.client && this.activated && !this.connection.error) await this.connect()
    const empty: Snapshot = {
      connection: this.connection, directory: this.activated ? this.directory : '', home, platform,
      projects: [], sessions: { data: [], cursor: {} }, active: [],
    }
    if (!this.client) return empty
    try {
      const [projects, sessions, active] = await Promise.all([
        this.client.project.list(timeout()), this.sessions(), this.activeSessions(),
      ])
      return { ...empty, connection: this.connection, projects, sessions, active }
    } catch (error) {
      this.updateConnection({ connected: false, error: errorMessage(error) })
      return { ...empty, connection: this.connection }
    }
  }

  async sessions(query: Parameters<OpenCodeAPI['sessions']>[0] = {}): Promise<SessionPage> {
    return this.ready().session.list({ ...query, limit: 50, parentID: 'null', ...(!query?.cursor && { order: 'desc' }) }, timeout())
  }

  async activeSessions() {
    if (!this.client || !this.connection.connected) return []
    return Object.keys(await this.client.session.active(timeout()))
  }

  // One-shot generation has no tools and creates/modifies no server sessions.
  async messages(id: string, cursor?: string): Promise<MessagePage> {
    return messagesForUI(await this.ready().message.list({ sessionID: id, limit: 40, ...(cursor ? { cursor } : { order: 'desc' }) }, timeout()))
  }

  async session(id: string): Promise<SessionDetail> {
    const client = this.ready()
    const [session, messages, permissions, forms, inbox] = await Promise.all([
      client.session.get({ sessionID: id }, timeout()), this.messages(id),
      client.permission.list({ sessionID: id }, timeout()),
      client.session.form.list({ sessionID: id }, timeout()),
      client.session.inbox.list({ sessionID: id }, timeout()),
    ])
    return { session, messages, permissions, forms, inbox }
  }

  async catalog(directory: string): ReturnType<OpenCodeAPI['catalog']> {
    const client = this.ready()
    const input = { location: { directory } }
    const [agents, models, defaultModel] = await Promise.all([
      client.agent.list(input, timeout()), client.model.list(input, timeout()), client.model.default(input, timeout()),
    ])
    return {
      agents: agents.data.filter(agent => !agent.hidden && agent.mode !== 'subagent'),
      models: models.data.filter(model => model.enabled).map(model => ({
        id: model.id, modelID: model.modelID, name: model.name, providerID: model.providerID,
        variants: model.variants.map(variant => ({ id: variant.id })), enabled: model.enabled, limit: model.limit,
      })),
      ...(defaultModel.data && { defaultModel: { id: defaultModel.data.id, providerID: defaultModel.data.providerID } }),
    }
  }

  async createSession(input: Parameters<OpenCodeAPI['createSession']>[0]): Promise<SessionInfo> {
    if (!input.directory) throw new Error('Choose a project folder first.')
    return this.ready().session.create({ location: { directory: input.directory }, agent: input.agent, model: input.model }, timeout())
  }

  async prompt(input: Parameters<OpenCodeAPI['prompt']>[0]) {
    if (!input.text.trim() && !input.files?.length) throw new Error('Write a message first.')
    await this.ready().session.prompt(input, timeout())
  }

  async interrupt(id: string) { await this.ready().session.interrupt({ sessionID: id }, timeout()) }

  async renameSession(id: string, title: string) {
    if (!title.trim()) throw new Error('The session name cannot be empty.')
    await this.ready().session.update({ sessionID: id, title: title.trim() }, timeout())
    return this.ready().session.get({ sessionID: id }, timeout())
  }

  async switchAgent(id: string, agent: string) { await this.ready().session.switchAgent({ sessionID: id, agent }, timeout()) }
  async switchModel(id: string, model: Parameters<OpenCodeAPI['switchModel']>[1]) { await this.ready().session.switchModel({ sessionID: id, model }, timeout()) }
  async permissionReply(input: Parameters<OpenCodeAPI['permissionReply']>[0]) { await this.ready().permission.reply(input, timeout()) }
  async formReply(input: Parameters<OpenCodeAPI['formReply']>[0]) { await this.ready().session.form.reply(input, timeout()) }
  async formCancel(input: Parameters<OpenCodeAPI['formCancel']>[0]) { await this.ready().session.form.cancel(input, timeout()) }

  async diff(input: Parameters<OpenCodeAPI['diff']>[0]) {
    const result = await this.ready().vcs.diff({ location: { directory: input.directory }, mode: input.mode }, timeout())
    return result.data
  }

  dispose() {
    this.disposed = true
    this.generation++
    this.stream?.abort()
  }
}

/** OpenCode as a ChatOS source: one bridge, its IPC methods and its remembered connection. */
export function createOpenCodeSource(ctx: MainContext): MainSource<'opencode'> {
  const store = ctx.storage, secrets = ctx.secrets
  const bridge = new OpenCodeBridge(event => ctx.emit(event), ctx.env.CHATOS_DIRECTORY || process.cwd(), {
    url: ctx.env.CHATOS_SERVER_URL, token: ctx.env.CHATOS_SERVER_TOKEN,
  }, {
    load: () => {
      const raw = store.get('opencode-source')
      if (!raw) return undefined
      const saved = JSON.parse(raw) as { url?: string }
      const secret = store.secret('opencode:token')
      let token: string | undefined
      if (secret && secrets.available()) { try { token = secrets.decrypt(secret) } catch { /* Locked keychain: reconnect without the token. */ } }
      return { ...(typeof saved.url === 'string' && { url: saved.url }), ...(token && { token }) }
    },
    save: settings => {
      if (!settings) { store.saveSecret('opencode:token'); store.delete('opencode-source'); return }
      store.saveSecret('opencode:token', settings.token && secrets.available() ? secrets.encrypt(settings.token) : undefined)
      store.set('opencode-source', JSON.stringify({ ...(settings.url && { url: settings.url }) }))
    },
  })
  const api: OpenCodeAPI = {
    probe: () => bridge.probe(), start: () => bridge.start(), disconnect: async () => bridge.disconnect(),
    bootstrap: () => bridge.bootstrap(ctx.home, ctx.platform), reconnect: settings => bridge.connect(settings),
    sessions: query => bridge.sessions(query), activeSessions: () => bridge.activeSessions(),
    session: id => bridge.session(id), messages: (id, cursor) => bridge.messages(id, cursor), catalog: directory => bridge.catalog(directory),
    createSession: input => bridge.createSession(input), prompt: input => bridge.prompt(input), interrupt: id => bridge.interrupt(id),
    renameSession: (id, title) => bridge.renameSession(id, title), switchAgent: (id, agent) => bridge.switchAgent(id, agent), switchModel: (id, model) => bridge.switchModel(id, model),
    permissionReply: input => bridge.permissionReply(input), formReply: input => bridge.formReply(input), formCancel: input => bridge.formCancel(input),
    diff: input => bridge.diff(input),
  }
  return { id: 'opencode', api, dispose: () => bridge.dispose() }
}
