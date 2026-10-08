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

export type DesktopEvent =
  | { type: 'server'; event: Record<string, unknown> }
  | { type: 'connection'; connection: ConnectionInfo }
  | { type: 'browser'; tab: BrowserState }
  | { type: 'browser-popup'; workspaceID: string; url: string; tileID?: string }
  | { type: 'tile-focus'; tileID: string }
  | { type: 'shortcut'; action: string }
  | { type: 'terminal'; id: string; data: string }
  | { type: 'terminal-exit'; id: string; code: number | null }

export interface BrowserState {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error?: string
}

export interface BrowserPlacement {
  id: string
  workspaceID: string
  url: string
  bounds: { x: number; y: number; width: number; height: number }
}

export interface BrowserContext {
  url: string
  title: string
  text: string
}

export interface ContextItem {
  id: string
  kind: 'page' | 'image' | 'file'
  name: string
  text?: string
  uri?: string
}

export type StageTab =
  | { id: string; kind: 'browser'; title: string; url: string }
  | { id: string; kind: 'review'; title: string }
  | { id: string; kind: 'details'; title: string }

export interface Workspace {
  id: string
  kind: 'session' | 'web'
  sessionID?: string
  title: string
  directory?: string
  hidden: boolean
  tabs: StageTab[]
  panes: [string | null, string | null]
  tabPane: Record<string, 0 | 1>
  split: false | 'vertical' | 'horizontal'
  focusedPane: 0 | 1
  fullscreen: boolean
  draft: string
  context: ContextItem[]
  closedTabs: StageTab[]
}

export interface WorkspaceState {
  version: 1
  activeID: string
  workspaces: Workspace[]
  folders: string[]
  selectedDirectory: string
  pinned: string[]
  homeDraft: string
}

export interface ChatOSAPI {
  modelInfo(): Promise<import('./model').ModelInfo>
  saveModel(input: import('./model').ModelSettings & { apiKey?: string }): Promise<import('./model').ModelInfo>
  forgetModelKey(): Promise<import('./model').ModelInfo>
  probeModel(input: { baseURL: string; apiKey?: string }): Promise<import('./model').ModelProbe>
  skipModel(): Promise<import('./model').ModelInfo>
  discoverSource(turns: import('./model').DiscoveryTurn[]): Promise<import('./model').DiscoveryResult>
  opencodeProbe(): Promise<OpenCodeProbe>
  opencodeStart(): Promise<ConnectionInfo>
  opencodeDisconnect(): Promise<ConnectionInfo>
  terminalOpen(input: { id: string; cwd: string; cols: number; rows: number }): Promise<{ cwd: string; shell: string; replay: string; alive: boolean }>
  terminalInput(id: string, data: string): Promise<void>
  terminalResize(id: string, cols: number, rows: number): Promise<void>
  terminalClose(id: string): Promise<void>
  terminalFocus(focused: boolean): Promise<void>
  findPaths(query: string): Promise<LocalPath[]>
  readImage(path: string): Promise<{ path: string; size: number; dataURL: string }>
  loadDesktop(legacy?: string | null): string | null
  flushDesktop(raw: string): void
  saveDesktop(raw: string): Promise<void>
  backupStorage(): Promise<string>
  connectors(): Promise<import('./connectors').ConnectorInfo[]>
  saveConnector(definition: import('./connectors').ConnectorDefinition, revision: number): Promise<import('./connectors').ConnectorInfo[]>
  connectorRevisions(id: string): Promise<{ revision: number; definition: import('./connectors').ConnectorDefinition }[]>
  connectorToken(id: string, token: string): Promise<import('./connectors').ConnectorInfo[]>
  connectorOAuth(id: string, clientSecret?: string): Promise<import('./connectors').ConnectorInfo[]>
  disconnectConnector(id: string): Promise<import('./connectors').ConnectorInfo[]>
  proposeConnector(input: { description: string; baseURL: string; documentation: string }): Promise<import('./connectors').ConnectorDefinition>
  searchConnectors(query: string, connectorID?: string): Promise<import('./connectors').ConnectorSearch>
  planConnectorSearch(query: string): Promise<import('./connectors').ConnectorSearch>
  readRecipe(ref: import('./connectors').ResourceRef, cursor?: string): Promise<import('./connectors').RecipePage>
  recipeAction(ref: import('./connectors').ResourceRef, operation: string, draft: string): Promise<void>
  inspectPath(path: string): Promise<LocalPath>
  listFolder(path: string): Promise<FolderPage>
  readTextFile(path: string): Promise<TextFile>
  services(): Promise<ServiceInfo[]>
  searchServices(query: string): Promise<ServiceSearch>
  frontConversations(input: { query: string; cursor?: string }): Promise<FrontPage>
  frontConversation(input: { id: string; cursor?: string }): Promise<FrontDetail>
  saveService(input: { id: ServiceID; url?: string; token?: string; front?: FrontIdentity }): Promise<ServiceInfo>
  validateService(id: ServiceID): Promise<{ ok: boolean; account?: string; error?: string }>
  disconnectService(id: ServiceID): Promise<void>
  removeService(id: ServiceID): Promise<void>
  bootstrap(): Promise<Snapshot>
  reconnect(settings?: { url?: string; token?: string }): Promise<ConnectionInfo>
  sessions(query?: { directory?: string; project?: string; search?: string; cursor?: string }): Promise<SessionPage>
  activeSessions(): Promise<string[]>
  session(id: string): Promise<SessionDetail>
  messages(id: string, cursor?: string): Promise<MessagePage>
  catalog(directory: string): Promise<{ agents: AgentInfo[]; models: ModelInfo[]; defaultModel?: ModelRef }>
  createSession(input: { directory: string; agent?: string; model?: ModelRef }): Promise<SessionInfo>
  prompt(input: { sessionID: string; text: string; files?: { uri: string; name?: string }[]; delivery: 'steer' | 'queue' }): Promise<void>
  interrupt(id: string): Promise<void>
  renameSession(id: string, title: string): Promise<SessionInfo>
  switchAgent(id: string, agent: string): Promise<void>
  switchModel(id: string, model: ModelRef): Promise<void>
  permissionReply(input: { sessionID: string; requestID: string; decision: 'once' | 'always' | 'reject' }): Promise<void>
  formReply(input: { sessionID: string; formID: string; answer: FormAnswer }): Promise<void>
  formCancel(input: { sessionID: string; formID: string }): Promise<void>
  diff(input: { directory: string; mode: 'working' | 'branch' | 'committed'; sessionID?: string }): Promise<FileDiff[]>
  chooseFolder(): Promise<string | null>
  chooseFiles(): Promise<{ uri: string; name: string }[]>
  browserLayout(placements: BrowserPlacement[]): Promise<void>
  browserAction(input: { id: string; action: 'navigate' | 'back' | 'forward' | 'reload' | 'focus' | 'devtools'; url?: string }): Promise<void>
  browserClose(id: string): Promise<void>
  browserContext(id: string, selection?: boolean): Promise<BrowserContext>
  browserScreenshot(id: string): Promise<string>
  onEvent(listener: (event: DesktopEvent) => void): () => void
}
export interface LocalPath { path: string; kind: 'folder' | 'file'; name: string }
export interface FolderEntry { path: string; name: string; kind: 'folder' | 'file' | 'link' | 'other' }
export interface FolderPage { path: string; parent: string; entries: FolderEntry[]; truncated: boolean }
export interface TextFile { path: string; text?: string; size: number; truncated: boolean; reason?: string }

export type ServiceID = 'slack' | 'front' | 'github'
export interface ServiceInfo {
  configured?: boolean
  id: ServiceID
  name: string
  url: string
  hasToken: boolean
  tokenStorage: 'encrypted' | 'session' | 'none'
  secureStorage: boolean
  account?: string
  front?: FrontIdentity
}
export interface FrontIdentity { email: string; teammateID: string; tagID: string }
export interface FrontConversation {
  id: string; subject: string; status: string; sender: string; preview: string;
  updatedAt?: number; assignee?: string; tags: string[];
}
export interface FrontMessage {
  id: string; subject: string; text: string; inbound: boolean; draft: boolean; createdAt?: number;
  recipients: { role: string; name: string; handle: string }[];
  attachments: { name: string; size?: number }[];
}
export interface FrontPage { items: FrontConversation[]; next?: string }
export interface FrontDetail { conversation: FrontConversation; messages: FrontMessage[]; next?: string }
export interface ServiceResource { service: ServiceID; title: string; url: string; description: string }
export interface ServiceSearch { resources: ServiceResource[]; error?: string; more?: boolean }

declare global {
  interface Window {
    chatos: ChatOSAPI
  }
}
