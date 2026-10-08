import { ArrowLeft, FolderOpen, Plus, Search, Star } from 'lucide-react'
import { useMemo } from 'react'
import type { SessionInfo, Workspace } from '../shared/types'
import { basename, directoryOf, sessionTitle } from '../shared/workspaces'
import { IconButton, ProjectBadge, Status, dayLabel, relativeTime, shortPath } from './ui'

export interface ProjectEntry {
  id: string
  directory: string
  name: string
  projectID?: string
  vcs?: string
}

interface HomeProps {
  projects: ProjectEntry[]
  selected?: ProjectEntry
  chooseProject: (project?: ProjectEntry) => void
  openFolder: () => void
  newSession: () => void
  sessions: SessionInfo[]
  openSession: (session: SessionInfo) => void
  workspaces: Workspace[]
  locations?: Record<string, string>
  active: string[]
  home: string
  pinned: string[]
  togglePin: (directory: string) => void
  search: string
  setSearch: (search: string) => void
  loading: boolean
  hasMore: boolean
  loadMore: () => void
  error?: string
  retry: () => void
}

export function Home(props: HomeProps) {
  const groups = useMemo(() => {
    const result = new Map<string, SessionInfo[]>()
    for (const session of props.sessions) {
      const group = dayLabel(session.time.updated)
      result.set(group, [...(result.get(group) || []), session])
    }
    return [...result]
  }, [props.sessions])
  const projects = props.projects.filter(project => `${project.name} ${project.directory}`.toLowerCase().includes(props.search.toLowerCase()))

  function sessionRow(session: SessionInfo) {
    const open = props.workspaces.find(w => w.sessionID === session.id && !w.hidden)
    const number = open ? props.workspaces.filter(w => !w.hidden).findIndex(w => w.id === open.id) + 1 : 0
    return <button className="session-row" key={session.id} onClick={() => props.openSession(session)} title={sessionTitle(session)}>
      <Status running={props.active.includes(session.id)} />
      {!props.selected && <ProjectBadge name={basename(directoryOf(session))} small />}
      <span className="session-row-title truncate">{sessionTitle(session)}</span>
      {props.selected && directoryOf(session) !== props.selected.directory && <span className="directory-tag truncate" title={directoryOf(session)}>{basename(directoryOf(session))}</span>}
      {!props.selected && <span className="session-project truncate">{basename(directoryOf(session))}</span>}
      {props.locations?.[session.id] ? <span className="open-badge">{props.locations[session.id]}</span> : number > 0 && <span className="open-badge">open on <kbd>{number}</kbd></span>}
      <span className="session-time">{props.active.includes(session.id) ? 'working' : relativeTime(session.time.updated)}</span>
    </button>
  }

  return <section className="home-stage panel">
    <header className="panel-header">
      {props.selected ? <>
        <button className="text-button" onClick={() => props.chooseProject()}><ArrowLeft size={15} />Projects</button>
        <ProjectBadge name={props.selected.name} small /><strong className="truncate">{props.selected.name}</strong>
        <span className="header-path truncate" title={props.selected.directory}>{shortPath(props.selected.directory, props.home)}</span>
        <button className="pill header-right" onClick={props.newSession}><Plus size={14} />New session</button>
      </> : <><strong>OpenCode projects</strong><button className="pill header-right" onClick={props.openFolder}><FolderOpen size={14} />Browse folder…</button></>}
    </header>
    <div className="home-stage-scroll">
      <label className="search-box"><Search size={15} /><input id="home-search" aria-label="Search projects and sessions" placeholder={props.selected ? `Search sessions in ${props.selected.name}` : 'Search projects and sessions'} value={props.search} onChange={event => props.setSearch(event.target.value)} /><kbd>/</kbd></label>
      {props.error && <div className="inline-error">{props.error}<button className="text-button" onClick={props.retry}>Retry</button></div>}
      {!props.selected && <div className="project-list">{projects.map(project => {
        const running = props.sessions.filter(session => props.active.includes(session.id) && (project.projectID ? session.projectID === project.projectID : directoryOf(session) === project.directory)).length
        return <div className="project-row" key={project.id}>
          <button className="project-open" title="OpenCode · Project · Show sessions" onClick={() => props.chooseProject(project)}>
            <ProjectBadge name={project.name} /><div className="project-copy"><span>{project.name}</span><span className="project-path truncate">{shortPath(project.directory, props.home)}</span></div>
            {project.vcs && <span className="directory-tag">{project.vcs}</span>}
            <span className="project-meta">{running > 0 ? <><Status running />{running} running</> : ''}</span>
          </button>
          <IconButton label={props.pinned.includes(project.directory) ? `Unpin ${project.name}` : `Pin ${project.name}`} className={props.pinned.includes(project.directory) ? 'pinned' : 'pin-project'} onClick={() => props.togglePin(project.directory)}><Star size={14} fill={props.pinned.includes(project.directory) ? 'currentColor' : 'none'} /></IconButton>
        </div>
      })}{!projects.length && <div className="empty-list">{props.search ? 'No matching projects.' : 'Open a folder to add your first project.'}</div>}</div>}
      {props.selected ? groups.map(([day, sessions]) => <div className="session-group" key={day}><h3>{day}</h3>{sessions.map(sessionRow)}</div>)
        : <div className="session-group"><h3>{props.search ? 'Matching sessions' : 'Recent sessions'}</h3>{props.sessions.slice(0, props.search ? undefined : 15).map(sessionRow)}</div>}
      {props.loading && <div className="list-loading"><Status running />Loading sessions…</div>}
      {!props.loading && !props.sessions.length && <div className="empty-list">{props.search ? 'No matching sessions.' : 'No sessions yet. Start one from the composer.'}</div>}
      {props.hasMore && <button className="load-more pill" disabled={props.loading} onClick={props.loadMore}>Load more sessions</button>}
    </div>
    <footer className="home-stage-footer"><span>Sessions live on OpenCode. Closing a workspace never stops them.</span><kbd>Ctrl+K</kbd><span>jump anywhere</span></footer>
  </section>
}
