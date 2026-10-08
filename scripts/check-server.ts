import { homedir } from 'node:os'
import { OpenCodeBridge } from '../src/main/opencode'

const bridge = new OpenCodeBridge(() => {}, process.cwd(), {
  url: process.env.CHATOS_SERVER_URL, token: process.env.CHATOS_SERVER_TOKEN,
})
try {
  const snapshot = await bridge.bootstrap(homedir(), process.platform)
  if (!snapshot.connection.connected) throw new Error(snapshot.connection.error)
  console.log(`Connected to OpenCode ${snapshot.connection.version} at ${snapshot.connection.url}`)
  console.log(`${snapshot.projects.length} projects; ${snapshot.sessions.data.length} recent root sessions; ${snapshot.active.length} running sessions`)
  const catalog = await bridge.catalog(process.cwd())
  console.log(`${catalog.agents.length} primary agents; ${catalog.models.length} enabled models`)
  const session = snapshot.sessions.data.find(session => !snapshot.active.includes(session.id))
  if (session) {
    const detail = await bridge.session(session.id)
    console.log(`Read one idle session: ${detail.messages.data.length} messages, ${detail.permissions.length} pending permissions, ${detail.forms.length} forms`)
  }
  console.log('Read-only check passed. No prompts sent or sessions changed.')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally { bridge.dispose() }
