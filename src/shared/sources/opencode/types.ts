/** OpenCode's data model, as ChatOS sees it. Only the OpenCode source uses these. */
export interface ModelRef {
  id: string
  providerID: string
  variant?: string
}

export interface SessionInfo {
  id: string
  parentID?: string
  projectID: string
  title?: string
  agent?: string
  model?: ModelRef
  cost: number
  tokens: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } }
  location: { directory?: string | null }
  time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number }
}

export interface ProjectInfo {
  id: string
  canonical: string
  name?: string
  vcs?: string
  sandboxes: string[]
  time: { created: number; updated: number; initialized?: number }
}

export interface ModelInfo {
  id: string
  modelID: string
  providerID: string
  name: string
  enabled: boolean
  variants: { id: string; name?: string }[]
  limit: { context: number; output: number; input?: number }
}

export interface AgentInfo {
  id: string
  name: string
  description?: string
  mode: 'primary' | 'subagent' | 'all'
  hidden: boolean
}

/** “/” in the composer: OpenCode commands (run) and skills (loaded into the turn). */
export interface SlashCommand { name: string; description?: string }
export interface SlashSkill { id: string; name: string; description?: string }

export interface ToolPart {
  type: 'tool'
  id: string
  name: string
  state: {
    status: 'streaming' | 'running' | 'completed' | 'error'
    input?: Record<string, unknown>
    content?: ({ type: 'text'; text: string } | { type: 'file'; [key: string]: unknown })[]
    error?: string
    metadata?: Record<string, unknown>
  }
  time: { created: number; ran?: number; completed?: number }
}

export interface MessageInfo {
  id: string
  type: string
  text?: string
  description?: string
  agent?: string
  model?: ModelRef
  content?: ({ type: 'text' | 'reasoning'; text: string } | ToolPart)[]
  files?: { uri?: string; name?: string; mime?: string }[]
  time: { created: number; completed?: number }
  error?: unknown
  finish?: string
  [key: string]: unknown
}

export interface PermissionRequest {
  id: string
  sessionID: string
  action: string
  resources: string[]
  save?: string[]
  message?: string
}

export interface FormField {
  key: string
  title?: string
  description?: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external'
  required?: boolean
  hidden?: boolean
  placeholder?: string
  default?: string | number | boolean | string[]
  options?: { value: string; label: string; description?: string }[]
  custom?: boolean
  format?: string
  when?: { key: string; op: 'eq' | 'neq'; value: string | number | boolean }[]
  url?: string
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}

export type FormAnswer = Record<string, string | number | boolean | string[]>

export interface SessionForm {
  id: string
  sessionID: string
  title: string
  fields: FormField[]
}

export interface FileDiff {
  file: string
  patch: string
  additions: number
  deletions: number
  status: 'added' | 'deleted' | 'modified'
}

export interface SessionPage {
  data: SessionInfo[]
  cursor: { previous?: string | null; next?: string | null }
}

export interface MessagePage {
  data: MessageInfo[]
  cursor: { previous?: string | null; next?: string | null }
}

export interface SessionDetail {
  session: SessionInfo
  messages: MessagePage
  permissions: PermissionRequest[]
  forms: SessionForm[]
  inbox: { id: string; type: string; [key: string]: unknown }[]
}

export interface ConnectionInfo {
  connected: boolean
  url?: string
  version?: string
  error?: string
  automatic: boolean
  /** OpenCode was added as a source (explicitly, or via CHATOS_SERVER_URL). */
  enabled?: boolean
  streaming?: boolean
}
export interface OpenCodeProbe { binary?: string; version?: string; running?: string; connection: ConnectionInfo }

export interface Snapshot {
  connection: ConnectionInfo
  projects: ProjectInfo[]
  sessions: SessionPage
  active: string[]
  directory: string
  home: string
  platform: string
}


export interface OpenCodeAPI {
  probe(): Promise<OpenCodeProbe>
  start(): Promise<ConnectionInfo>
  disconnect(): Promise<ConnectionInfo>
  bootstrap(): Promise<Snapshot>
  reconnect(settings?: { url?: string; token?: string }): Promise<ConnectionInfo>
  sessions(query?: { directory?: string; project?: string; search?: string; cursor?: string }): Promise<SessionPage>
  activeSessions(): Promise<string[]>
  session(id: string): Promise<SessionDetail>
  messages(id: string, cursor?: string): Promise<MessagePage>
  catalog(directory: string): Promise<{ agents: AgentInfo[]; models: ModelInfo[]; defaultModel?: ModelRef; commands: SlashCommand[]; skills: SlashSkill[] }>
  /** Files and folders in the project matching a fuzzy query, for “@” mentions. */
  findFiles(directory: string, query: string): Promise<{ path: string; type: 'file' | 'directory' }[]>
  createSession(input: { directory: string; agent?: string; model?: ModelRef }): Promise<SessionInfo>
  /** With a directory, “@path” mentions attach those files and a leading “/name” runs that command or skill. */
  prompt(input: { sessionID: string; text: string; files?: { uri: string; name?: string }[]; delivery: 'steer' | 'queue'; directory?: string }): Promise<void>
  interrupt(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<SessionInfo>
  /** Deletes the session in OpenCode for good, after a native confirmation. OpenCode has no undo. */
  deleteSession(input: { sessionID: string; title: string; draft?: boolean }): Promise<void>
  /** Projects hidden from ChatOS's lists. OpenCode can't remove projects; nothing is deleted. */
  hiddenProjects(): Promise<string[]>
  hideProject(directory: string, hidden: boolean): Promise<string[]>
  switchAgent(id: string, agent: string): Promise<void>
  switchModel(id: string, model: ModelRef): Promise<void>
  permissionReply(input: { sessionID: string; requestID: string; decision: 'once' | 'always' | 'reject' }): Promise<void>
  formReply(input: { sessionID: string; formID: string; answer: FormAnswer }): Promise<void>
  formCancel(input: { sessionID: string; formID: string }): Promise<void>
  diff(input: { directory: string; mode: 'working' | 'branch' | 'committed'; sessionID?: string }): Promise<FileDiff[]>
}
export const opencodeMethods = ['bootstrap', 'reconnect', 'sessions', 'activeSessions', 'session', 'messages', 'catalog', 'findFiles', 'createSession', 'prompt', 'interrupt', 'renameSession', 'deleteSession', 'hiddenProjects', 'hideProject', 'switchAgent', 'switchModel', 'permissionReply', 'formReply', 'formCancel', 'diff', 'probe', 'start', 'disconnect'] as const satisfies readonly (keyof OpenCodeAPI)[]
/** Main → renderer live events. */
export type OpenCodeEvent = { type: 'server'; event: Record<string, unknown> } | { type: 'connection'; connection: ConnectionInfo }
