import { createServer, type ServerResponse } from 'node:http'
import type { MessageInfo, SessionInfo, SessionForm, PermissionRequest } from '../../src/shared/sources/opencode/types'

export async function fixtureServer(options?: { requestLimit?: number; createDelay?: number; promptDelay?: number; generate?: (prompt: string) => string }) {
  const directory = process.cwd()
  const location = { directory }
  const otherDirectory = `${directory}/health-fixture`
  const projects = [{ id: 'project_fixture', canonical: directory, name: 'chatos', time: { created: 1, updated: 1 }, sandboxes: [] }, { id: 'project_health', canonical: otherDirectory, name: 'health', time: { created: 1, updated: 1 }, sandboxes: [] }]
  const sessions: SessionInfo[] = [1, 2, 3, 4, 5].map(n => ({
    id: `ses_fixture_${n}`, projectID: n <= 3 ? 'project_fixture' : 'project_health', title: ['Consent reload', 'Health sources', 'Consent tests', 'Email sync', 'PR cleanup'][n - 1],
    agent: 'build', model: { providerID: 'fixture', id: 'test-model' }, location: { directory: n <= 3 ? directory : otherDirectory }, cost: 0,
    tokens: { input: 0, output: 0 }, time: { created: Date.now() - n * 1_000, updated: Date.now() - n * 1_000 },
  }))
  const messages = new Map<string, MessageInfo[]>()
  const permissions = new Map<string, PermissionRequest[]>()
  const forms = new Map<string, SessionForm[]>()
  const subscribers = new Set<ServerResponse>()
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = []
  let counter = 5
  const people = ['Carl', 'Anna', 'Bob']
  const conversation = (id: string, subject: string, handle: string, blurb: string, status = 'open') => ({ id, subject, status, recipient: { handle }, last_message: { blurb, created_at: Math.floor(Date.now() / 1000) }, tags: [{ name: 'me' }] })
  const conversations = [
    conversation('cnv_101', 'Duplikate rekvisisjoner igjen', 'ingrid@furst.test', 'Det skjedde igjen i natt', 'assigned'),
    conversation('cnv_102', 'Login loop on staging', 'ops@example.test', 'Users bounce back to login'),
    conversation('cnv_103', 'Invoice question', 'billing@example.test', 'Can you check March?'),
    conversation('cnv_123', 'Lab reply', 'carl@example.test', 'Your lab results are ready', 'assigned'),
  ]
  const frontWrites: { id: string; kind: string; body: string }[] = []
  const model = { id: 'test-model', modelID: 'test-model', providerID: 'fixture', name: 'Test model', enabled: true, variants: [{ id: 'high' }], limit: { context: 100_000, output: 4_000 } }
  const emit = (type: string, data: Record<string, unknown>) => {
    for (const subscriber of subscribers) subscriber.write(`data: ${JSON.stringify({ id: `evt_${Date.now()}`, created: Date.now(), type, data })}\n\n`)
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost')
    const path = url.pathname
    if (path === '/api/event') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      response.write(`data: ${JSON.stringify({ id: 'evt_connected', type: 'server.connected', data: {} })}\n\n`)
      subscribers.add(response); request.on('close', () => subscribers.delete(response)); return
    }
    if (path.startsWith('/preview')) {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      const title = path === '/preview' ? 'Local preview' : path.slice('/preview/'.length).replaceAll('-', ' ')
      response.end(`<!doctype html><title>${title}</title><h1>${title}</h1><button id="remember" onclick="localStorage.setItem('owner','session-one')">Remember this session</button><p>Browser context for a session.</p><a href="/preview/dm-carl" target="_blank">DM Carl</a>`); return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : {}
    requests.push({ method: request.method || 'GET', path, body })
    if (options?.requestLimit && requests.length > options.requestLimit) requests.splice(0, Math.floor(options.requestLimit / 2))
    const json = (data: unknown) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)) }
    const done = () => { response.writeHead(204); response.end() }
    if (path === '/api/info') return json({ version: '2.0.24', pid: process.pid, urls: [], paths: { tmp: '/tmp/opencode' } })
    if (path === '/api/experimental/generate' && options?.generate) return json({ data: { text: options.generate(String(body.prompt)) } })
    // OpenAI-compatible model endpoint for K (base URL: `${url}/v1`).
    if (path === '/v1/models') return json({ object: 'list', data: [{ id: 'fixture-embedding' }, { id: 'fixture-chat' }] })
    if (path === '/v1/chat/completions' && options?.generate) {
      const messages = body.messages as { content: string }[]
      return json({ choices: [{ message: { role: 'assistant', content: options.generate(messages[0].content) } }] })
    }
    // Fake Front, Slack and GitHub APIs for the built-in connectors (CHATOS_CONNECTOR_URLS). No real accounts.
    if (path.startsWith('/front/')) {
      const route = path.slice('/front'.length)
      if (route === '/me') return json({ email: 'me@example.test' })
      if (route === '/conversations') return json({ _results: [conversations[3]] })
      const search = route.match(/^\/conversations\/search\/(.+)$/)
      if (search) { const q = decodeURIComponent(search[1]); return json({ _results: q.includes('tag:') ? conversations.slice(0, 3) : q.includes('to:') ? [conversations[3]] : [] }) }
      const one = route.match(/^\/conversations\/(cnv_\w+)(?:\/(messages|comments))?$/)
      const c = one && conversations.find(x => x.id === one[1])
      if (one && c) {
        if (request.method === 'POST') { frontWrites.push({ id: c.id, kind: one[2] === 'messages' ? 'reply' : 'comment', body: String(body.body) }); response.writeHead(202, { 'Content-Type': 'application/json' }); response.end('{}'); return }
        if (one[2] === 'messages') return json({ _results: [{ id: `msg_${c.id.slice(4)}`, subject: c.subject, text: `${c.last_message.blurb}. Please take a look.`, is_inbound: true, created_at: Math.floor(Date.now() / 1000) - 60, recipients: [{ role: 'from', handle: c.recipient.handle, name: c.recipient.handle.split('@')[0] }], attachments: [{ filename: 'results.txt', url: 'https://example.test/secret-attachment' }] }] })
        if (one[2] === 'comments') return json({ _results: frontWrites.filter(w => w.id === c.id && w.kind === 'comment').map((w, i) => ({ id: `com_${i}`, body: w.body, posted_at: Math.floor(Date.now() / 1000), author: { username: 'me' } })) })
        return json(c)
      }
    }
    if (path.startsWith('/slack/')) {
      const method = path.slice('/slack/'.length)
      if (method === 'auth.test') return json({ ok: true, user: 'me', team: 'Fixture', team_id: 'T123', user_id: 'U001' })
      if (method === 'users.list') return json({ ok: true, members: people.map((name, i) => ({ id: `U10${i}`, name: name.toLowerCase(), profile: { real_name: `${name} Hansen`, display_name: name } })), response_metadata: {} })
      if (method === 'conversations.list') return json({ ok: true, channels: people.map((_, i) => ({ id: `D10${i}`, user: `U10${i}` })), response_metadata: {} })
      if (method === 'search.messages') return json({ ok: true, messages: { matches: [{ iid: 'm1', text: 'Can you look at the deploy?', permalink: 'https://fixture.slack.com/archives/C1/p1', channel: { name: 'ops' }, username: 'carl', ts: '1700000000.0001' }] } })
    }
    if (path === '/github/user') return json({ login: 'me-test' })
    if (path === '/github/search/issues') return json({ items: [{ id: 1, number: 42, title: 'Consent fix', state: 'open', html_url: 'https://github.com/acme/amino/pull/42', user: { login: 'carl' } }] })
    if (path === '/api/project') return json(projects)
    if (path === '/api/session/active') return json({ data: {} })
    if (path === '/api/model' || path === '/api/model/default') return json({ location, data: path.endsWith('default') ? model : [model] })
    if (path === '/api/agent') return json({ location, data: [{ id: 'build', name: 'Build', mode: 'primary', hidden: false }, { id: 'plan', name: 'Plan', mode: 'primary', hidden: false }] })
    if (path === '/api/session') {
      if (request.method === 'POST') {
        if (options?.createDelay) await new Promise(resolve => setTimeout(resolve, options.createDelay))
        const requested = String((body.location as { directory?: string } | undefined)?.directory || directory)
        const session: SessionInfo = { ...sessions[0], id: `ses_fixture_${++counter}`, title: 'New session', projectID: requested === otherDirectory ? 'project_health' : 'project_fixture', location: { directory: requested }, agent: String(body.agent || 'build'), model: body.model as SessionInfo['model'] || sessions[0].model, time: { created: Date.now(), updated: Date.now() } }
        sessions.unshift(session); emit('session.created', { sessionID: session.id }); return json({ data: session })
      }
      const search = url.searchParams.get('search')?.toLowerCase() || ''
      const requestedDirectory = url.searchParams.get('directory'), requestedProject = url.searchParams.get('project')
      return json({ data: sessions.filter(session => session.title?.toLowerCase().includes(search) && (!requestedDirectory || session.location.directory === requestedDirectory) && (!requestedProject || session.projectID === requestedProject)), cursor: {} })
    }
    if (path === '/api/vcs/diff') return json({ location, data: [{ file: 'consent.ts', patch: '@@ -1,1 +1,1 @@\n-before\n+after', additions: 1, deletions: 1, status: 'modified' }] })
    const match = path.match(/^\/api\/session\/(ses_[^/]+)(?:\/(.*))?$/)
    if (match) {
      const [, id, action] = match
      const session = sessions.find(session => session.id === id)
      if (!session) { response.writeHead(404); response.end(); return }
      if (!action) {
        if (request.method === 'PATCH') { session.title = String(body.title); emit('session.renamed', { sessionID: id, title: session.title }); return done() }
        return json({ data: session })
      }
      if (action === 'message') return json({ data: [...(messages.get(id) || [])].reverse(), cursor: {} })
      if (action === 'inbox') return json({ data: [] })
      if (action === 'permission') return json({ data: permissions.get(id) || [] })
      if (action === 'form') return json({ data: forms.get(id) || [] })
      if (action === 'prompt') {
        if (options?.promptDelay) await new Promise(resolve => setTimeout(resolve, options.promptDelay))
        const text = String(body.text)
        // Like OpenCode, a new session takes its title from the first message.
        if (session.title === 'New session') { session.title = text.slice(0, 48); emit('session.renamed', { sessionID: id, title: session.title }) }
        messages.set(id, [...(messages.get(id) || []),
          { id: `msg_user_${Date.now()}`, type: 'user', text, time: { created: Date.now() } },
          { id: `msg_assistant_${Date.now()}`, type: 'assistant', agent: 'build', model: session.model, content: [{ type: 'text', text: 'Fixture response: your message reached the OpenCode 2 API.' }], time: { created: Date.now() + 1, completed: Date.now() + 2 }, finish: 'stop' },
        ])
        emit('session.execution.started', { sessionID: id }); emit('session.execution.succeeded', { sessionID: id })
        return json({ data: { id: `inb_${Date.now()}`, sessionID: id, type: 'user', payload: { text }, delivery: body.delivery, time: { created: Date.now() } } })
      }
      if (action === 'model') { session.model = body.model as SessionInfo['model']; return done() }
      if (action === 'agent') { session.agent = String(body.agent); return done() }
      if (action.startsWith('permission/') && action.endsWith('/reply')) { permissions.set(id, []); emit('permission.replied', { sessionID: id }); return done() }
      if (action.startsWith('form/')) { forms.set(id, []); emit('form.replied', { sessionID: id }); return done() }
      if (action === 'interrupt') return json({ data: { interrupted: true } })
    }
    response.writeHead(404); response.end(`Unhandled fixture path: ${path}`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${address.port}`, requests, sessions, frontWrites,
    /** Point the built-in connectors at this server instead of the real services. */
    connectorURLs: JSON.stringify({ front: `http://127.0.0.1:${address.port}/front`, slack: `http://127.0.0.1:${address.port}/slack`, github: `http://127.0.0.1:${address.port}/github` }),
    seedHistory(id: string, count: number) {
      messages.set(id, Array.from({ length: count }, (_, i) => ({ id: `history_${i}`, type: 'assistant', content: [{ type: 'text', text: `Earlier response ${i}: ${'A detailed discussion of the current work. '.repeat(8)}` }], time: { created: i + 1, completed: i + 2 } })))
      emit('session.message.created', { sessionID: id })
    },
    askPermission(id: string) { const permission = { id: 'per_fixture', sessionID: id, action: 'shell', resources: ['echo test'] }; permissions.set(id, [permission]); emit('permission.asked', permission) },
    askQuestion(id: string) { const form: SessionForm = { id: 'frm_fixture', sessionID: id, title: 'Which source should win?', fields: [{ key: 'source', type: 'string', title: 'Source', required: true, options: [{ value: 'device', label: 'Device' }, { value: 'newest', label: 'Newest' }] }] }; forms.set(id, [form]); emit('form.created', { sessionID: id }) },
    async close() { for (const subscriber of subscribers) subscriber.end(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) },
  }
}
