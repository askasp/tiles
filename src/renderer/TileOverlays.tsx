import { FileText, FolderOpen, Globe, LayoutGrid, Mail, MessageSquare, SquareTerminal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConnectionInfo, LocalPath, ServiceID, ServiceInfo, ServiceSearch, SessionInfo } from '../shared/types'
import type { OpenMode, Tile, TileDesktop, TileInput } from '../shared/tiles'
import { browserTile, fileTile, focusedTile, frontConversationTile, frontInboxTile, projectsTile, projectTile, recipeTile, sessionTile, shelfTiles, tileTitle } from '../shared/tiles'
import type { ConnectorDefinition, ConnectorInfo, ConnectorSearch } from '../shared/connectors'
import { addIntent, launcherIntent, launcherScope, modelIntent, resourceAction, resourceSource, sources, terminalIntent, type SourceID } from '../shared/sources'
import type { ModelInfo } from '../shared/model'
import { frontConversationID } from '../shared/front'
import { basename } from '../shared/workspaces'
import { api, friendlyError, type ProjectEntry } from './data'
import { IconButton, Modal, Status } from './ui'
import { ConnectorSetup, KChips, KReply, KRow, ModelSetup, OpenCodeSetup, ServiceSetup, iconText } from './Setup'

export const tileSource = (tile: Tile) => tile.kind === 'recipe' ? tile.sourceName || tile.resource?.connectorID || 'Connector' : sources.find(s => s.id === resourceSource(tile))!.name
export function TileIcon({ kind, size = 15 }: { kind: TileInput['kind']; size?: number }) {
  return kind === 'file' ? <FileText size={size} /> : kind === 'folder' ? <FolderOpen size={size} /> : kind.startsWith('front-') ? <Mail size={size} /> : kind === 'browser' ? <Globe size={size} /> : kind === 'terminal' ? <SquareTerminal size={size} /> : kind === 'project' ? <FolderOpen size={size} /> : kind === 'session' ? <MessageSquare size={size} /> : <LayoutGrid size={size} />
}
/** Short badge used in tile headers, the shelf and K rows. */
export const tileBadge = (tile: Pick<TileInput, 'kind' | 'url'>) => {
  if (tile.kind === 'recipe') return 'connector'
  const source = resourceSource(tile as TileInput)
  return source === 'web' ? 'web' : source
}
export function Badge({ icon, size = 'md' }: { icon: string; size?: 'sm' | 'md' }) {
  return <span className={`k-icon k-icon-${icon} ${size}`} aria-hidden>{iconText[icon] || icon.slice(0, 2)}</span>
}
export function tileLocation(tile: Tile, desktop: TileDesktop) {
  const w = desktop.workspaces.find(w => w.id === tile.workspaceID)
  return tile.status === 'shelf' ? 'on the shelf' : tile.status === 'closed' ? 'closed' : `open on ${w?.slot || '?'}`
}
/** What a result is, in the words of its source: “Folder”, “OpenCode project”, “Front conversation”. */
function resourceLabel(input: TileInput, sourceName: string, kindLabel: string) {
  const fixed: Partial<Record<TileInput['kind'], string>> = { browser: 'Web page', folder: 'Folder', file: 'File', terminal: 'Terminal', projects: 'OpenCode' }
  if (input.kind === 'recipe') return `${input.sourceName || 'Connector'} ${input.resource?.resourceID ? 'item' : 'list'}`
  return fixed[input.kind] || `${sourceName} ${kindLabel.toLowerCase()}`
}
const urlLike = (s: string) => /^(https?:\/\/|localhost[:/]|127\.0\.0\.1[:/]|\[::1\])|^[^\s/]+\.[a-z]{2,}(?:[/:?#]\S*)?$/i.test(s)
const rank = (text: string, query: string) => {
  text = text.toLowerCase(); query = query.toLowerCase()
  if (!query) return 1
  if (text === query) return 100
  if (text.startsWith(query)) return 50
  return query.split(/\s+/).every(word => text.includes(word)) ? 10 : 0
}
interface Other { label: string; run: (mode: OpenMode) => void | Promise<void> }
interface Row { key: string; icon: string; title: string; source: string; subtitle: string; action: string; waiting?: boolean; scope?: SourceID; fill?: string; others?: Other[]; run: (mode: OpenMode) => void | Promise<void> }

export interface LauncherProps {
  desktop: TileDesktop; sessions: SessionInfo[]; projects: ProjectEntry[]; waiting: string[];
  open: (input: TileInput, mode: OpenMode) => void; newSession: (directory?: string, mode?: OpenMode, project?: boolean, message?: string) => void;
  terminal: (directory?: string, mode?: OpenMode) => void;
  tidy: (id: string) => void; undo: () => void; close: () => void; serviceLinks: { name: string; url: string; front?: boolean }[];
  initialSource?: SourceID; initialQuery?: string;
  availableSources: SourceID[]; connection: ConnectionInfo; projectCount: number;
  connectors: ConnectorInfo[]; connectorsChanged: (list: ConnectorInfo[]) => void; adjustConnector: (definition?: ConnectorDefinition) => void;
  services: ServiceInfo[]; servicesChanged: (list: ServiceInfo[]) => void;
  model?: ModelInfo; modelChanged: (info: ModelInfo) => void; firstRun: boolean;
  reconnect: (settings?: { url?: string; token?: string }) => Promise<void>;
  home: string; signIn: (command: string) => void;
}
export function TileLauncher(props: LauncherProps) {
  const { desktop, sessions, projects, waiting, open, newSession, terminal, tidy, undo, close, serviceLinks, connectors, availableSources, connection, model } = props
  const opencodeConnected = connection.connected
  const [query, setQuery] = useState(props.initialQuery || '')
  const [scope, setScope] = useState<SourceID | undefined>(props.initialSource)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const [index, setIndex] = useState(0)
  const [expanded, setExpanded] = useState<string>()
  const [committed, setCommitted] = useState<string>()
  const [greeting, setGreeting] = useState('')
  const [remote, setRemote] = useState<SessionInfo[]>([])
  const [remoteError, setRemoteError] = useState(false)
  const [searching, setSearching] = useState(false)
  const [providerResult, setProviderResult] = useState<ServiceSearch>({ resources: [] })
  const [providerBusy, setProviderBusy] = useState(false)
  const [connectorResult, setConnectorResult] = useState<ConnectorSearch>({ resources: [], errors: [] })
  const [connectorBusy, setConnectorBusy] = useState(false)
  const [found, setFound] = useState<LocalPath[]>([])
  const searchVersion = useRef(0)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const enter = useRef<() => void>(undefined)
  const add = addIntent(query)
  const panel = props.firstRun || modelIntent(query) ? 'model' as const
    : add?.known === 'opencode' ? 'opencode' as const
    : add?.known ? 'service' as const
    : add && committed === add.name.toLowerCase() ? 'connector' as const : undefined
  const tidyQuery = /^(just |hide everything but |keep only )/i.test(query.trim())
  const intent = launcherIntent(query, scope)
  const clean = intent.query, source = launcherScope(query, scope), providerSource = intent.source
  const targetQuery = tidyQuery ? query.trim().replace(/^(just |hide everything but |keep only )/i, '') : clean
  const searchable = !panel && !add
  const providerQuery = searchable && providerSource && ['front', 'slack', 'github'].includes(providerSource) && availableSources.includes(providerSource) ? `${providerSource === 'slack' && /^dm(?:\s|:)/i.test(query.trim()) ? 'dm' : sources.find(s => s.id === providerSource)!.prefix} ${clean}` : ''
  const focusedResource = focusedTile(desktop)
  // A file's folder counts as the focused folder too.
  const focusedDirectory = focusedResource?.kind === 'file' ? focusedResource.path!.replace(/\/[^/]*$/, '') || '/' : focusedResource?.directory
  const [sessionProject, firstMessage] = intent.create ? (() => { const i = clean.indexOf(':'); return i < 0 ? [clean, ''] : [clean.slice(0, i).trim(), clean.slice(i + 1).trim()] })() : ['', '']
  useEffect(() => {
    setRemote([]); setRemoteError(false)
    if (!searchable || !opencodeConnected || !clean || urlLike(clean) || tidyQuery || intent.create || (source && source !== 'opencode')) { setSearching(false); return }
    let valid = true
    setSearching(true)
    const timer = setTimeout(() => { void api.sessions({ search: clean }).then(page => { if (valid) { setRemote(page.data); setRemoteError(false) } }).catch(() => { if (valid) setRemoteError(true) }).finally(() => { if (valid) setSearching(false) }) }, 180)
    return () => { valid = false; clearTimeout(timer) }
  }, [clean, tidyQuery, source, intent.create, opencodeConnected, searchable])
  useEffect(() => {
    setProviderResult({ resources: [] })
    if (!providerQuery || tidyQuery) { setProviderBusy(false); return }
    let valid = true; setProviderBusy(true)
    const timer = setTimeout(() => { void api.searchServices(providerQuery).then(result => { if (valid) setProviderResult(result) }).catch(() => { if (valid) setProviderResult({ resources: [], error: 'Could not search this source.' }) }).finally(() => { if (valid) setProviderBusy(false) }) }, 350)
    return () => { valid = false; clearTimeout(timer) }
  }, [providerQuery, tidyQuery])
  useEffect(() => {
    const version = ++searchVersion.current
    setConnectorResult({ resources: [], errors: [] })
    if (!searchable || (!clean || clean.length < 2) || urlLike(clean) || tidyQuery || intent.create || (source && !source.startsWith('connector:')) || !connectors.length) { setConnectorBusy(false); return }
    setConnectorBusy(true)
    const timer = setTimeout(() => { void api.searchConnectors(clean, source?.startsWith('connector:') ? source.slice(10) : undefined).then(result => { if (version === searchVersion.current) setConnectorResult(result) }).catch(e => { if (version === searchVersion.current) setConnectorResult({ resources: [], errors: [friendlyError(e)] }) }).finally(() => { if (version === searchVersion.current) setConnectorBusy(false) }) }, 400)
    return () => { clearTimeout(timer); searchVersion.current++ }
  }, [clean, source, tidyQuery, intent.create, connectors, searchable])
  useEffect(() => {
    setFound([])
    if (!searchable || clean.length < 2 || urlLike(clean) || clean.includes('/') || tidyQuery || intent.create || (source && source !== 'files' && source !== 'terminal')) return
    let valid = true
    const timer = setTimeout(() => { void api.findPaths(clean).then(paths => { if (valid) setFound(paths) }).catch(() => {}) }, 150)
    return () => { valid = false; clearTimeout(timer) }
  }, [clean, searchable, tidyQuery, intent.create, source])
  const askAI = async () => {
    const version = ++searchVersion.current; setConnectorBusy(true); setOpenError('')
    try { const result = await api.planConnectorSearch(query); if (version === searchVersion.current) setConnectorResult(result) }
    catch (e) { if (version === searchVersion.current) setOpenError(friendlyError(e)) }
    finally { if (version === searchVersion.current) setConnectorBusy(false) }
  }
  const rows = useMemo<Row[]>(() => {
    if (panel) return []
    if (add) {
      return [{ key: 'add-ai', icon: 'add', title: `Add ${add.name}`, source: 'K', subtitle: model?.ready ? 'K looks up its API and proposes how it shows up · nothing is kept until you approve' : 'needs a model · Super+K → model', action: 'Ask K', run: () => { setCommitted(add.name.toLowerCase()) } }]
    }
    if (/^(?:add|connect)\s*$/i.test(query)) {
      const known: { id: ServiceID | 'opencode'; name: string; hint: string; done: boolean }[] = [
        { id: 'opencode', name: 'OpenCode', hint: 'projects and coding sessions', done: connection.enabled === true },
        { id: 'front', name: 'Front', hint: 'shared inboxes, with an API token', done: availableSources.includes('front') },
        { id: 'github', name: 'GitHub', hint: 'pull requests to review, with a token', done: availableSources.includes('github') },
        { id: 'slack', name: 'Slack', hint: 'DMs and mentions, with a user token', done: availableSources.includes('slack') },
      ]
      return [...known.filter(k => !k.done).map(k => ({ key: `add:${k.id}`, icon: k.id, title: `Add ${k.name}`, source: 'Source', subtitle: k.hint, action: 'Set up', fill: `add ${k.id}`, run: () => {} })),
        { key: 'add:any', icon: 'add', title: 'Add anything with an API', source: 'K', subtitle: 'type its name, e.g. “add linear” · K builds a connector', action: 'Type a name', fill: 'add ', run: () => {} },
        { key: 'add:model', icon: 'ai', title: model?.ready ? `Model · ${model.model}` : 'Connect a model', source: 'Model', subtitle: 'the AI that powers K', action: 'Set up', fill: 'model', run: () => {} }]
    }
    const candidates: { input: TileInput; existing?: Tile; score: number }[] = desktop.tiles.map(tile => ({ input: { ...tile, title: tileTitle(tile) }, existing: tile, score: Math.max(rank(`${tileTitle(tile)} ${tile.title} ${tile.url || ''} ${tile.frontQuery || ''} ${tile.path || ''} ${tile.directory || ''} ${tile.kind}`, targetQuery), query.trim() ? rank(tileTitle(tile), query.trim()) : 0) }))
    const keys = new Set(desktop.tiles.map(t => t.key))
    for (const input of [...(opencodeConnected ? [projectsTile()] : []), ...connectors.flatMap(c => c.definition.recipes.filter(r => r.shape === 'collection' && !c.definition.operations.find(op => op.id === r.operation)?.path.includes('{parent}')).map(r => recipeTile({ connectorID: c.definition.id, recipeID: r.id }, r.label, r, c.definition.name)))]) {
      if (!keys.has(input.key)) { candidates.push({ input, score: rank(`${input.title} ${input.sourceName || 'OpenCode projects'}`, targetQuery) }); keys.add(input.key) }
    }
    for (const session of opencodeConnected ? [...remote, ...sessions] : []) {
      const input = sessionTile(session)
      if (!keys.has(input.key)) { candidates.push({ input, score: Math.max(rank(`${input.title} ${input.directory || ''}`, targetQuery), query.trim() ? rank(input.title, query.trim()) : 0) }); keys.add(input.key) }
    }
    for (const file of found.filter(f => f.kind === 'file')) {
      const input = fileTile(file.path, 'file', file.name)
      if (!keys.has(input.key)) { candidates.push({ input, score: rank(file.name, targetQuery) || 5 }); keys.add(input.key) }
    }
    const folders: ProjectEntry[] = found.filter(f => f.kind === 'folder').map(f => ({ id: `folder:${f.path}`, name: f.name, directory: f.path }))
    for (const project of [...projects, ...folders.filter(f => !projects.some(p => p.directory === f.directory))]) {
      for (const input of [fileTile(project.directory, 'folder', project.name), ...(opencodeConnected && project.projectID ? [projectTile(project.directory, project.name)] : [])]) {
        if (!keys.has(input.key)) { candidates.push({ input, score: rank(`${project.name} ${project.directory}`, targetQuery) }); keys.add(input.key) }
      }
    }
    const focused = focusedTile(desktop)
    if (opencodeConnected && focused?.directory && focused.kind !== 'terminal') {
      const review: TileInput = { key: `review:${focused.directory}`, kind: 'review', title: `Review changes · ${basename(focused.directory)}`, directory: focused.directory }
      if (!keys.has(review.key)) candidates.push({ input: review, score: rank(review.title, targetQuery) })
    }
    if (opencodeConnected && focused?.sessionID) {
      const details: TileInput = { key: `details:${focused.sessionID}`, kind: 'details', title: `Details · ${focused.title}`, directory: focused.directory, sessionID: focused.sessionID, linkID: focused.kind === 'session' ? focused.id : focused.linkID }
      if (!keys.has(details.key)) candidates.push({ input: details, score: rank(details.title, targetQuery) })
    }
    for (const link of serviceLinks) {
      try { const input = link.front ? frontInboxTile('is:open', 'Front · API inbox') : { ...browserTile(link.url), title: link.name }; if (!keys.has(input.key)) candidates.push({ input, score: rank(link.name, targetQuery) }) } catch { /* Bad saved URL cannot break search. */ }
    }
    for (const resource of providerResult.resources) {
      try {
        const frontID = resource.service === 'front' ? frontConversationID(resource.url) : undefined
        const input = frontID ? { ...frontConversationTile(frontID, resource.title), label: resource.title } : { ...browserTile(resource.url), title: resource.title, label: resource.title }
        const existing = candidates.find(c => c.input.key === input.key)
        if (existing) { existing.score = 100; if (frontID) existing.input = { ...input, title: existing.input.title } }
        else candidates.push({ input, score: 100 })
      } catch { /* Unsafe provider URLs are never opened. */ }
    }
    for (const resource of connectorResult.resources) {
      const connector = connectors.find(c => c.definition.id === resource.ref.connectorID)
      const recipe = connector?.definition.recipes.find(r => r.id === resource.ref.recipeID)
      if (!recipe || !connector) continue
      const input = recipeTile(resource.ref, resource.title, recipe, connector.definition.name)
      const existing = candidates.find(c => c.input.key === input.key)
      if (existing) existing.score = 100
      else { candidates.push({ input, score: 100 }); keys.add(input.key) }
    }
    const matches = candidates.filter(c => c.score > 0 && !intent.create && (!source || resourceSource(c.input) === source) && (!tidyQuery || !!c.existing)).sort((a, b) => b.score - a.score || (b.existing?.lastUsed || 0) - (a.existing?.lastUsed || 0)).slice(0, 30)
    const openResource = async (input: TileInput, mode: OpenMode) => {
      if (input.kind === 'folder' || input.kind === 'file') {
        const path = await api.inspectPath(input.path!)
        open(fileTile(path.path, path.kind), mode)
      } else open(input, mode)
    }
    const othersFor = (input: TileInput): Other[] => {
      const dir = input.kind === 'file' ? input.path!.replace(/\/[^/]*$/, '') || '/' : input.directory
      const result: Other[] = []
      if (input.kind === 'file') result.push({ label: 'Show in folder', run: mode => openResource(fileTile(dir!), mode) })
      if (input.kind === 'project') result.push({ label: 'Start session', run: mode => newSession(input.directory, mode) }, { label: 'Browse files', run: mode => openResource(fileTile(input.directory!), mode) }, { label: 'Review changes', run: mode => open({ key: `review:${input.directory}`, kind: 'review', title: `Review changes · ${basename(input.directory!)}`, directory: input.directory }, mode) })
      if (input.kind === 'folder' && opencodeConnected) result.push({ label: 'Show OpenCode sessions', run: mode => open(projectTile(input.path!), mode) }, { label: 'Start OpenCode session here', run: mode => newSession(input.path, mode) })
      if (dir && ['folder', 'file', 'project', 'session'].includes(input.kind)) result.push({ label: 'Open terminal here', run: mode => terminal(dir, mode) })
      return result
    }
    const result: Row[] = matches.map(({ input, existing }) => {
      const [sourceName, kindLabel, actionLabel] = resourceAction(input).split(' · ')
      const visible = existing?.status === 'visible'
      const place = input.path || input.directory || input.url || ''
      return {
        key: input.key, icon: tileBadge(input), title: tidyQuery ? `Keep only ${input.title} + linked tiles` : input.title,
        source: resourceLabel(input, sourceName, kindLabel),
        subtitle: [input.kind === 'recipe' ? kindLabel : '', props.home && place.startsWith(props.home) ? `~${place.slice(props.home.length)}` : place, existing ? tileLocation(existing, desktop) : ''].filter(Boolean).join(' · '),
        action: tidyQuery ? 'Keep only' : visible ? 'Go to tile' : existing?.status === 'shelf' ? 'Bring back' : actionLabel,
        waiting: !!input.sessionID && waiting.includes(input.sessionID), others: tidyQuery ? undefined : othersFor(input),
        run: (mode: OpenMode) => { if (tidyQuery && existing) tidy(existing.id); else return openResource(input, mode) },
      }
    })
    if (tidyQuery) return result
    if (urlLike(clean) && !clean.startsWith('/') && !intent.create && (!source || source === 'web')) {
      try {
        const input = browserTile(clean), existing = desktop.tiles.find(t => t.key === input.key)
        result.unshift({ key: 'url', icon: 'web', title: input.title, source: 'Web page', subtitle: input.url!, action: existing?.status === 'visible' ? 'Go to tile' : 'Open in Browser', run: mode => open(input, mode) })
      } catch { /* Invalid URL remains searchable. */ }
    }
    const shell = terminalIntent(query)
    if (shell && !intent.create) {
      const dir = shell[1]?.trim().startsWith('/') ? shell[1].trim() : projects.find(p => shell[1] && rank(`${p.name} ${p.directory}`, shell[1].trim()))?.directory || focusedDirectory || props.home
      result.unshift({ key: 'terminal', icon: 'terminal', title: 'Terminal', source: 'Terminal', subtitle: `in ${dir === props.home ? '~' : dir}${!shell[1] && focusedDirectory ? ', the focused folder' : ''}`, action: 'Open terminal', run: mode => terminal(dir, mode) })
    }
    if (source === 'front' && !availableSources.includes('front')) result.unshift({ key: 'add-front', icon: 'front', title: 'Add Front to read mail here', source: 'Source', subtitle: 'Front isn’t connected yet · needs an API token', action: 'Set up', fill: 'add front', run: () => {} })
    else if (source === 'front' && !intent.create && clean.length <= 300) {
      const input = frontInboxTile(clean || 'is:open')
      result.unshift({ key: 'front-filter', icon: 'front', title: clean ? `Front inbox · ${clean}` : 'Front inbox', source: 'Front inbox', subtitle: 'reads conversations · mail is not changed', action: 'Show conversations', run: mode => open(input, mode) })
    }
    if (intent.create) {
      if (!opencodeConnected) result.push({ key: 'add-opencode', icon: 'opencode', title: 'Add OpenCode to start sessions', source: 'Source', subtitle: 'OpenCode isn’t connected yet', action: 'Set up', fill: 'add opencode', run: () => {} })
      else {
        for (const project of projects.filter(p => sessionProject && rank(`${p.name} ${p.directory}`, sessionProject))) result.push({ key: `new-session:${project.directory}`, icon: 'opencode', title: `Start session in ${project.name}`, source: 'OpenCode action', subtitle: firstMessage ? `first message: ${firstMessage}` : `${project.directory} · asks for a first message in the tile`, action: 'Start', run: mode => newSession(project.directory, mode, false, firstMessage || undefined) })
        if (!sessionProject) result.push({ key: 'new-session', icon: 'opencode', title: focusedDirectory ? `Start session in ${basename(focusedDirectory)}` : 'New session', source: 'OpenCode action', subtitle: 'in the focused folder · no prompt sent', action: 'Start', run: mode => newSession(undefined, mode) })
      }
    }
    if (!intent.create && clean.startsWith('/') && (!source || source === 'files')) result.unshift({ key: 'local-path', icon: 'files', title: clean, source: 'Local path', subtitle: 'folder, text or image · read-only', action: 'Open', others: [{ label: 'Open terminal here', run: mode => terminal(clean, mode) }], run: async mode => { const path = await api.inspectPath(clean); open(fileTile(path.path, path.kind), mode) } })
    if (!source && !intent.create && clean) {
      for (const entry of sources.filter(s => availableSources.includes(s.id) && s.name.toLowerCase() === clean.toLowerCase() && !(s.id === 'terminal' && shell))) result.unshift({ key: `source:${entry.id}`, icon: entry.id, title: entry.name, source: 'Source', subtitle: entry.hint, action: 'Narrow to source', scope: entry.id, run: () => {} })
      if (!availableSources.includes('opencode') && /^opencode$/i.test(clean)) result.unshift({ key: 'add-opencode', icon: 'opencode', title: 'Add OpenCode', source: 'Source', subtitle: 'not connected yet', action: 'Set up', fill: 'add opencode', run: () => {} })
    }
    if (!query.trim() && !scope) result.push({ key: 'add-source', icon: 'add', title: 'Add a source', source: 'K', subtitle: model?.ready ? 'OpenCode, Front, GitHub, or anything with an API' : 'OpenCode, Front, GitHub… · a model lets K add any API', action: 'Choose', fill: 'add ', run: () => {} })
    if (clean && !intent.create && !clean.startsWith('/') && (!source || source === 'web')) {
      const q = clean.slice(0, 500)
      result.push({ key: 'web-search', icon: 'search', title: `Search the web for “${q}”`, source: 'Web search', subtitle: 'DuckDuckGo', action: 'Search', run: mode => open(browserTile(`https://duckduckgo.com/?q=${encodeURIComponent(q)}`), mode) })
    }
    return result
  }, [panel, add, query, model?.ready, model?.model, connection.enabled, desktop, projects, sessions, remote, targetQuery, clean, source, intent.create, tidyQuery, serviceLinks, waiting, open, newSession, terminal, tidy, providerResult, connectors, connectorResult, availableSources, opencodeConnected, focusedDirectory, sessionProject, firstMessage, props.home, found])
  const expandedRow = rows.find(r => r.key === expanded)
  const shown: Row[] = expandedRow ? expandedRow.others!.map((o, i) => ({ key: `${expandedRow.key}:other:${i}`, icon: expandedRow.icon, title: o.label, source: expandedRow.source, subtitle: expandedRow.title, action: o.label, run: o.run })) : rows
  useEffect(() => { list.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }) }, [index])
  // Clicked rows and finished panels unmount; keep typing and ↵ going to K.
  useEffect(() => { if (document.activeElement === document.body || !document.activeElement?.isConnected) input.current?.focus() })
  useEffect(() => { setExpanded(undefined) }, [query, scope])
  const chosen = Math.min(index, shown.length - 1)
  const execute = async (mode: OpenMode, i = chosen) => {
    const row = shown[i]
    if (!row || opening) return
    if (row.scope) { setScope(row.scope); setQuery(''); setIndex(0); setOpenError(''); return }
    if (row.fill !== undefined) { setQuery(row.fill); setIndex(0); input.current?.focus(); return }
    if (row.key === 'add-ai') { void row.run(mode); return }
    setOpening(true); setOpenError('')
    try { await row.run(mode); close() } catch (e) { setOpenError(friendlyError(e)); setOpening(false) }
  }
  const scopes: { id: SourceID; name: string }[] = [...sources.filter(s => availableSources.includes(s.id)), ...connectors.map(c => ({ id: `connector:${c.definition.id}` as SourceID, name: c.definition.name }))]
  const scopeName = scope && scopes.find(s => s.id === scope)?.name
  const done = () => close()
  const foot = panel || add ? ['↵ continue', 'esc cancel'] : expandedRow ? ['↑↓ choose', '↵ run here', '← back'] : ['↑↓ choose', '↵ open here', '⌃↵ new workspace', '→ other actions', scope ? '⌫ widen to everything' : 'Tab narrow to a source']
  return <Modal title="Launcher" close={close}>
    <div className="launcher-input k-input-row"><span className="k-logo">K</span>{scopeName && <button className="k-scope" onClick={() => { setScope(undefined); input.current?.focus() }} title="Widen to all sources">{scopeName}<span>›</span></button>}<input ref={input} autoFocus aria-label="Launcher search" placeholder={props.firstRun ? 'Connect a model to get started' : scopeName ? `Search ${scopeName.toLowerCase()}…` : 'Ask or open… a page, folder, terminal, or “add …”'} value={query} onChange={e => { setQuery(e.target.value); setIndex(0); setOpenError(''); setProviderResult({ resources: [] }); setRemote([]) }} onKeyDown={e => {
      if (e.nativeEvent.isComposing) return
      if (panel) { if (e.key === 'Enter') { e.preventDefault(); enter.current?.() } return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
      if (e.key === 'ArrowRight' && !expandedRow && shown[chosen]?.others?.length && e.currentTarget.selectionStart === query.length) { e.preventDefault(); setExpanded(shown[chosen].key); setIndex(0) }
      if (e.key === 'ArrowLeft' && expandedRow) { e.preventDefault(); setIndex(Math.max(0, rows.indexOf(expandedRow))); setExpanded(undefined) }
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && scopes.length) {
        e.preventDefault(); e.stopPropagation()
        const byName = clean && !add && scopes.find(s => s.name.toLowerCase().startsWith(clean.toLowerCase()))
        const at = scopes.findIndex(s => s.id === scope)
        // Tab walks All → each source → Add source → All.
        if (byName && !scope) { setScope(byName.id); setQuery('') }
        else if (/^add\s*$/i.test(query)) { setQuery(''); setScope(undefined) }
        else if (at === scopes.length - 1) { setScope(undefined); setQuery('add ') }
        else setScope(scopes[at + 1].id)
        setIndex(0)
      }
      if (e.key === 'Enter') { e.preventDefault(); void execute(e.shiftKey ? 'move' : e.ctrlKey ? 'new' : 'here') }
      if (e.key === 'Backspace' && !query && scope) { e.preventDefault(); setScope(undefined); setIndex(0) }
      if (e.key === 'z' && e.ctrlKey && !query) { e.preventDefault(); undo() }
    }} /><kbd>esc</kbd><IconButton label="Close launcher" onClick={close}><X size={15} /></IconButton></div>
    {!panel && !add && <nav className="launcher-sources" aria-label="Search sources"><button className={`pill ${!source ? 'primary' : ''}`} aria-pressed={!source} onClick={() => { setScope(undefined); setQuery(clean); setIndex(0) }}>All sources</button>{scopes.map(s => <button key={s.id} className={`pill ${source === s.id ? 'primary' : ''}`} aria-pressed={source === s.id} onClick={() => { setScope(s.id); setQuery(clean); setIndex(0); setOpenError('') }}>{s.name}</button>)}<button className="pill" onClick={() => { setScope(undefined); setQuery('add '); input.current?.focus() }}>Add source</button>{!!connectors.length && model?.ready && <button className="pill" disabled={connectorBusy || !query.trim()} onClick={() => void askAI()}>Ask K to find…</button>}</nav>}
    {panel === 'model' && <ModelSetup info={model} firstRun={props.firstRun} enter={enter} opencode={{ connection, reconnect: props.reconnect, home: props.home, signIn: props.signIn }} saved={info => { props.modelChanged(info); setQuery(''); input.current?.focus(); setGreeting(`Ready. ${info.model} powers K. Browser, Files and Terminal are built in; anything else with an API you can add by asking.`) }} skip={props.firstRun ? () => { void api.skipModel().then(info => { props.modelChanged(info); setQuery(''); input.current?.focus(); setGreeting('Browser, Files and Terminal are ready. Type “model” here whenever you want K to add services for you.') }).catch(e => setOpenError(friendlyError(e))) } : undefined} />}
    {panel === 'opencode' && <OpenCodeSetup connection={connection} projects={props.projectCount} reconnect={props.reconnect} enter={enter} done={done} openProjects={() => { open(projectsTile(), 'here'); close() }} />}
    {panel === 'service' && add?.known && add.known !== 'opencode' && <ServiceSetup key={add.known} id={add.known} service={props.services.find(s => s.id === add.known)} changed={props.servicesChanged} enter={enter} done={done} openFront={() => { open(frontInboxTile('is:open', 'Front · API inbox'), 'here'); close() }} />}
    {panel === 'connector' && add && <ConnectorSetup key={add.name.toLowerCase()} name={add.name} model={model} connectors={connectors} changed={props.connectorsChanged} enter={enter} open={i => open(i, 'here')} adjust={d => props.adjustConnector(d)} setupModel={() => setQuery('model')} done={done} />}
    {greeting && !query && !panel && <KReply>{greeting}</KReply>}
    {intent.create && opencodeConnected && firstMessage && !panel && <KChips items={[{ label: 'Project', value: sessionProject || '—' }, { label: 'Agent', value: 'default' }, { label: 'First message', value: firstMessage }]} />}
    {openError && <div className="inline-error" role="alert">{openError}</div>}
    {!panel && !!connectorResult.errors.length && <div className="inline-error">{connectorResult.errors.slice(0, 2).join(' · ')}</div>}
    {!panel && <div className="tile-launcher-results" ref={list}>{expandedRow && <span className="k-head">Other actions · {expandedRow.title}</span>}{shown.map((row, i) => <KRow key={row.key} icon={row.icon} title={row.title} label={`${row.title} · ${row.source} · ${row.action}`} source={row.source} subtitle={row.subtitle} action={row.action} hint={i === chosen ? '↵' : row.others?.length && !expandedRow ? '→' : ''} selected={i === chosen} disabled={opening} onClick={() => { setIndex(i); void execute('here', i) }} />)}
      {!shown.length && <div className="empty-list">{providerBusy || searching ? 'Searching… ↵ won’t create anything.' : 'Nothing matches. Try a title, folder, URL, or “add …” for a new source.'}</div>}
      {!!rows.some(r => r.waiting) && <span className="k-head"><Status waiting /> waiting on you</span>}
    </div>}
    <footer className="k-foot">{foot.map(f => <span key={f}>{f}</span>)}<span className="k-status">{opening ? 'Opening…' : providerBusy || connectorBusy ? 'Searching connected sources…' : providerResult.error || (searching ? 'Searching sessions…' : remoteError ? 'Session search unavailable' : '')}</span></footer>
  </Modal>
}

export function TileOverview({ desktop, waiting, focus, move, go, close }: { desktop: TileDesktop; waiting: string[]; focus: (id: string) => void; move: (id: string, slot: number) => void; go: (slot: number) => void; close: () => void }) {
  const [destination, setDestination] = useState(desktop.workspaces.find(w => w.id === desktop.activeID)?.slot || 1)
  return <Modal title="Workspace overview" close={close} wide>
    <div className="modal-heading"><LayoutGrid size={18} /><h2>Workspaces & shelf</h2><span className="muted">One tile, one place</span><IconButton label="Close overview" onClick={close}><X size={15} /></IconButton></div>
    <div className="tile-overview"><div className="tile-workspace-cards">{desktop.workspaces.map(w => <section className={`tile-workspace-card ${desktop.activeID === w.id ? 'selected' : ''}`} key={w.id} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); move(e.dataTransfer.getData('text/chatos-tile'), w.slot); close() }}>
      <button className="overview-workspace-heading" onClick={() => { go(w.slot); close() }}><kbd>{w.slot}</kbd><strong>{w.title}</strong><span>{w.tileIDs.length}/4</span></button>
      {w.tileIDs.map(id => { const t = desktop.tiles.find(t => t.id === id)!; return <button className="overview-tile-row" key={id} draggable onDragStart={e => e.dataTransfer.setData('text/chatos-tile', id)} onClick={() => { focus(id); close() }}><TileIcon kind={t.kind} /><span className="truncate">{tileTitle(t)}</span>{t.sessionID && waiting.includes(t.sessionID) && <Status waiting />}</button> })}
      {!w.tileIDs.length && <p className="muted">Empty · open something with Super+K</p>}
    </section>)}{!desktop.workspaces.length && <p className="muted">No workspaces yet. Super+K opens the first tile.</p>}</div>
    <aside className="overview-shelf"><h3>Shelf · {shelfTiles(desktop).length}</h3><label className="form-field">Move selected tile to workspace<input aria-label="Shelf destination workspace" type="number" min={1} value={destination} onChange={e => setDestination(Math.max(1, Number(e.target.value)))} /></label>
      {shelfTiles(desktop).map(t => <div className="overview-shelf-row" key={t.id} draggable onDragStart={e => e.dataTransfer.setData('text/chatos-tile', t.id)}><button onClick={() => { focus(t.id); close() }}><TileIcon kind={t.kind} /><span className="truncate">{tileTitle(t)}</span>{t.sessionID && waiting.includes(t.sessionID) && <Status waiting />}</button><button className="text-button" aria-label={`Move ${tileTitle(t)} to workspace ${destination}`} onClick={() => { move(t.id, destination); close() }}>Move</button></div>)}
      {!shelfTiles(desktop).length && <p className="muted">Hidden tiles stay live here. Search finds closed tiles too.</p>}
    </aside></div>
    <footer className="modal-footer"><span>Drag a tile onto a workspace, or use Move. Sessions and shells keep running.</span></footer>
  </Modal>
}
