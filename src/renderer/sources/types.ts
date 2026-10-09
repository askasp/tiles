import type { MutableRefObject, ReactNode } from 'react'
import type { OpenMode, Tile, TileDesktop, TileInput } from '../../shared/tiles'
import type { ConnectorDefinition, ConnectorInfo } from '../../shared/connectors'
import type { ModelInfo } from '../../shared/model'

/** What the desktop offers every source. Sources never import each other. */
export interface Env {
  desktop: TileDesktop
  home: string
  model?: ModelInfo
  connectors: ConnectorInfo[]
  setConnectors(list: ConnectorInfo[]): void
  editConnector(target: { id?: string; definition?: ConnectorDefinition }): void
  open(input: TileInput, mode?: OpenMode): void
  /** Navigate this tile to another resource in place. Back (Ctrl+O, ⌘[) returns, draft intact. */
  replaceTile(id: string, input: TileInput): void
  /** Open from a list: ↵ in place of the list, Ctrl/⌘+↵ beside it, Ctrl/⌘+Shift+↵ in a new workspace. */
  openFrom(tileID: string, input: TileInput, how: ListOpen): void
  /** Back/forward through what this tile showed. False when there's nowhere to go. */
  tileBack(id: string): boolean
  tileForward(id: string): boolean
  tileTrail(id: string): { back: number; forward: number }
  focus(id: string): void
  changeTile(id: string, patch: Partial<Tile>): void
  setDesktop(update: (s: TileDesktop) => TileDesktop): void
  notify(text: string, error?: boolean, key?: string): void
  reportError(text: string): void
  /** Open K, optionally with a query or narrowed to a source. */
  ask(query?: string, scope?: string): void
  openURL(url: string, linkID?: string): void
  openTerminal(directory?: string, mode?: OpenMode, command?: string): void
  closeOverlay(): void
  /** Send a page (or its selection) as context to a tile that takes it. Never sends anything. */
  attach(tileID: string, selection?: boolean): void
  /** The “open a URL” dialog. */
  address(): void
  /** → actions every source offers on this resource. */
  othersFor(input: TileInput): Other[]
}

export type ListOpen = 'replace' | 'beside' | 'workspace'
/** How a key or click on a list row opens it. */
export const listOpen = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): ListOpen => e.ctrlKey || e.metaKey ? e.shiftKey ? 'workspace' : 'beside' : 'replace'

/** A K query, already split into source scope and words. */
export interface Query {
  /** What the person typed. */
  raw: string
  /** Without source prefixes and verbs like “open”. */
  text: string
  scope?: string
  /** The source a prefix named (`mail …`, `dm …`), even when K isn't narrowed to it. */
  prefix?: string
  rank(text: string): number
}
/** Another action on a resource. `key` works in that resource's tile; `icon` is a lucide icon name. */
export interface Other { label: string; run(mode: OpenMode): void | Promise<void>; key?: string; icon?: 'terminal' | 'sessions' | 'new' | 'folder' | 'review' }
/** A result row that is not simply “open this resource”, e.g. “Start session in chatos”. */
export interface Row {
  key: string; icon: string; title: string; source: string; subtitle: string; action: string
  waiting?: boolean
  /** Enter narrows K to this source instead of running. */
  scope?: string
  /** Enter replaces the query with this text. */
  fill?: string
  others?: Other[]
  /** Commands go first, results after. */
  first?: boolean
  /** While shown, other results are hidden: e.g. “start session in …” must never open something else. */
  exclusive?: boolean
  disabled?: boolean
  run(mode: OpenMode): void | Promise<void>
}
export interface Candidate { input: TileInput; score: number }
export interface TileProps<S> { tile: Tile; state: S; env: Env; visible: boolean; focused: boolean; focusKey: number }
export interface SetupProps<S> { state: S; env: Env; name: string; done(): void; enter: MutableRefObject<(() => void) | undefined> }

export interface Source<S = unknown> {
  /** The catalogue id: scope, “add <id>”, settings row. */
  id: string
  /** Badge shown on rows, tiles and the shelf. */
  badge: string
  /** Tile kinds this source renders. */
  kinds: readonly string[]
  /** Live state. Called on every render of the desktop, in registry order. */
  use(env: Env): S
  /** Listed in K and searched. Built-ins are always added. */
  added(state: S): boolean
  scopes?(state: S): { id: string; name: string }[]
  status?(state: S): { key: string; name: string; ok: boolean; label: string }[]
  candidates?(q: Query, state: S, env: Env): Candidate[]
  /** Slower lookups (servers, APIs). Runs debounced; never for sources that aren't added. */
  search?(q: Query, state: S, env: Env): Promise<Candidate[]> | undefined
  commands?(q: Query, state: S, env: Env): Row[]
  /** → actions this source offers on any resource, e.g. “Open terminal here” on a folder. */
  others?(input: TileInput, state: S, env: Env): Other[]
  Setup?(props: SetupProps<S>): ReactNode
  Settings?(props: { state: S; env: Env }): ReactNode
  Tile?(props: TileProps<S>): ReactNode
  /** Lists (sessions, a folder, an inbox) take a narrow column beside work tiles. Work tiles are the default. */
  isList?(tile: Tile): boolean
  tileStatus?(tile: Tile, state: S): { running?: boolean; waiting?: boolean } | undefined
  headerActions?(tile: Tile, state: S, env: Env): ReactNode
  /** Resources waiting on the person, in order. */
  waiting?(state: S, env: Env): { key: string; open(): void }[]
  onShortcut?(action: string, state: S, env: Env): boolean
  /** Where a page or selection can be sent as context (never sent on its own). */
  contextTargets?(state: S): { id: string; title: string; subtitle: string; input: TileInput }[]
  acceptsContext?: readonly string[]
  rename?(tile: Tile, title: string, state: S): Promise<boolean>
  /** Called before the tile closes for good, e.g. to end a shell. */
  closed?(tile: Tile): void
}
export type AnySource = Source<any> // eslint-disable-line @typescript-eslint/no-explicit-any
export const source = <S,>(s: Source<S>): Source<S> => s
