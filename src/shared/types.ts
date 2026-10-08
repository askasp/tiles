export type DesktopEvent =
  /** Live events of an added source, e.g. OpenCode's session stream. */
  | { type: 'source'; source: string; event: unknown }
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

/** Core API. Each added source contributes its own namespace, e.g. `chatos.opencode`. */
export interface CoreAPI {
  modelInfo(): Promise<import('./model').ModelInfo>
  saveModel(input: import('./model').ModelSettings & { apiKey?: string }): Promise<import('./model').ModelInfo>
  forgetModelKey(): Promise<import('./model').ModelInfo>
  probeModel(input: { baseURL: string; apiKey?: string }): Promise<import('./model').ModelProbe>
  skipModel(): Promise<import('./model').ModelInfo>
  discoverSource(turns: import('./model').DiscoveryTurn[]): Promise<import('./model').DiscoveryResult>
  terminalOpen(input: { id: string; cwd: string; cols: number; rows: number }): Promise<{ cwd: string; shell: string; replay: string; alive: boolean }>
  terminalInput(id: string, data: string): Promise<void>
  terminalResize(id: string, cols: number, rows: number): Promise<void>
  terminalClose(id: string): Promise<void>
  /** While a terminal has focus or a dialog is open, plain Ctrl keys go to it instead of tile management. */
  keyMode(mode: 'terminal' | 'overlay', active: boolean): Promise<void>
  environment(): Promise<{ home: string; platform: string }>
  /** System, light or dark. Also applies to web pages in Browser tiles. */
  theme(mode?: 'system' | 'light' | 'dark'): Promise<'system' | 'light' | 'dark'>
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
  /** A connector that ships with ChatOS (Front, Slack, GitHub), before it is added. */
  builtinConnector(id: string): Promise<{ definition: import('./connectors').ConnectorDefinition; hint: string; settings: { key: string; label: string }[] } | undefined>
  addBuiltinConnector(id: string): Promise<import('./connectors').ConnectorInfo[]>
  removeConnector(id: string): Promise<import('./connectors').ConnectorInfo[]>
  connectorSettings(id: string, values: Record<string, string>): Promise<import('./connectors').ConnectorInfo[]>
  proposeConnector(input: { description: string; baseURL: string; documentation: string }): Promise<import('./connectors').ConnectorDefinition>
  searchConnectors(query: string, connectorID?: string): Promise<import('./connectors').ConnectorSearch>
  planConnectorSearch(query: string): Promise<import('./connectors').ConnectorSearch>
  readRecipe(ref: import('./connectors').ResourceRef, cursor?: string): Promise<import('./connectors').RecipePage>
  recipeAction(ref: import('./connectors').ResourceRef, operation: string, draft: string): Promise<void>
  inspectPath(path: string): Promise<LocalPath>
  listFolder(path: string): Promise<FolderPage>
  readTextFile(path: string): Promise<TextFile>
  chooseFolder(): Promise<string | null>
  chooseFiles(): Promise<{ uri: string; name: string }[]>
  browserLayout(placements: BrowserPlacement[]): Promise<void>
  browserAction(input: { id: string; action: 'navigate' | 'back' | 'forward' | 'reload' | 'focus' | 'devtools'; url?: string }): Promise<void>
  browserClose(id: string): Promise<void>
  browserContext(id: string, selection?: boolean): Promise<BrowserContext>
  browserScreenshot(id: string): Promise<string>
  onEvent(listener: (event: DesktopEvent) => void): () => void
}
export type ChatOSAPI = CoreAPI & import('./registry-api').SourceAPIs
export interface LocalPath { path: string; kind: 'folder' | 'file'; name: string }
export interface FolderEntry { path: string; name: string; kind: 'folder' | 'file' | 'link' | 'other' }
export interface FolderPage { path: string; parent: string; entries: FolderEntry[]; truncated: boolean }
export interface TextFile { path: string; text?: string; size: number; truncated: boolean; reason?: string }

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

declare global {
  interface Window {
    chatos: ChatOSAPI
  }
}
