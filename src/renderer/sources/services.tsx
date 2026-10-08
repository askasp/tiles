import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ServiceID, ServiceInfo } from '../../shared/types'
import { browserTile, frontConversationTile, frontInboxTile } from '../../shared/tiles'
import { frontConversationID } from '../../shared/front'
import { api, friendlyError } from '../data'
import { FrontConversationBody, FrontInbox } from '../FrontTiles'
import { ServiceCard } from '../ServiceSettings'
import { ServiceSetup } from './service-setup'
import { source, type Candidate, type Row } from './types'

/** One shared list of services; every service source reads and updates it. */
let services: ServiceInfo[] = []
const listeners = new Set<() => void>()
let loading: Promise<void> | undefined
export function setServices(list: ServiceInfo[]) { services = list; for (const listener of listeners) listener() }
const reload = () => api.services().then(setServices)
function useServices() {
  const list = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => services)
  useEffect(() => { loading ||= reload().catch(() => { loading = undefined }) }, [])
  return list
}
const added = (s?: ServiceInfo) => Boolean(s && (s.configured || s.hasToken))
const titles: Record<ServiceID, string> = { slack: 'DMs and mentions', front: 'API mail inbox', github: 'review requested PRs' }

interface ServiceState { service?: ServiceInfo }
function serviceSource(id: ServiceID, name: string, prefix: string) {
  return source<ServiceState>({
    id, badge: id, kinds: id === 'front' ? ['front-list', 'front-conversation'] : [],
    use(env) {
      const service = useServices().find(s => s.id === id)
      // An API reader replaces a Front web view of the same conversation: release the page.
      const readers = id === 'front' ? env.desktop.tiles.filter(t => t.kind === 'front-conversation').map(t => t.id).sort().join('|') : ''
      useEffect(() => { for (const tile of readers ? readers.split('|') : []) void api.browserClose(tile).catch(() => {}) }, [readers])
      return { service }
    },
    added: state => added(state.service),
    status: state => added(state.service) ? [{ key: id, name: id, ok: Boolean(state.service!.hasToken), label: `${name} source` }] : [],
    candidates(q, state) {
      if (!added(state.service)) return []
      try {
        const input = id === 'front' ? frontInboxTile('is:open', 'Front · API inbox') : { ...browserTile(state.service!.url), title: `${name} · ${titles[id]}` }
        return [{ input, score: q.rank(`${name} · ${titles[id]}`) }]
      } catch { return [] }
    },
    search(q, state) {
      if (q.prefix !== id || !added(state.service)) return undefined
      const command = id === 'slack' && /^dm(?:\s|:)/i.test(q.raw.trim()) ? 'dm' : prefix
      return api.searchServices(`${command} ${q.text}`).then(result => result.resources.flatMap((resource): Candidate[] => {
        try {
          const frontID = resource.service === 'front' ? frontConversationID(resource.url) : undefined
          return [{ input: frontID ? { ...frontConversationTile(frontID, resource.title), label: resource.title } : { ...browserTile(resource.url), title: resource.title, label: resource.title }, score: 100 }]
        } catch { return [] }
      }))
    },
    commands(q, state, env) {
      if (id !== 'front' || q.prefix !== 'front') return []
      if (!added(state.service)) return [{ key: 'add-front', icon: 'front', title: 'Add Front to read mail here', source: 'Source', subtitle: 'Front isn’t connected yet · needs an API token', action: 'Set up', fill: 'add front', first: true, exclusive: true, run: () => {} }]
      if (q.text.length > 300) return []
      const input = frontInboxTile(q.text || 'is:open')
      return [{ key: 'front-filter', icon: 'front', title: q.text ? `Front inbox · ${q.text}` : 'Front inbox', source: 'Front inbox', subtitle: 'reads conversations · mail is not changed', action: 'Show conversations', first: true, run: mode => env.open(input, mode) } satisfies Row]
    },
    Setup: ({ state, env, done, enter }) => <ServiceSetup id={id} service={state.service} changed={setServices} enter={enter} done={done} openFront={() => { env.open(frontInboxTile('is:open', 'Front · API inbox')); done() }} />,
    Settings: ({ state, env }) => added(state.service) ? <ServiceRow service={state.service!} openURL={url => { env.openURL(url); env.closeOverlay() }} openFront={id === 'front' ? () => { env.open(frontInboxTile('is:open', 'Front · API inbox')); env.closeOverlay() } : undefined} /> : null,
    Tile({ tile, state, env, visible }) {
      if (tile.kind === 'front-list') return <FrontInbox tile={tile} visible={visible} account={state.service} open={env.open} settings={() => env.ask('add front')} web={() => env.openURL(state.service?.url || 'https://app.frontapp.com/')} />
      return <FrontConversationBody tile={tile} visible={visible} account={state.service} settings={() => env.ask('add front')} change={patch => env.changeTile(tile.id, patch)} web={() => { env.changeTile(tile.id, { kind: 'browser', label: tile.label || tile.title }); env.focus(tile.id) }} />
    },
    headerActions: (tile, _state, env) => id === 'front' && tile.kind === 'browser' && tile.url && frontConversationID(tile.url) ? <button className="text-button" onClick={() => env.open(frontConversationTile(frontConversationID(tile.url!)!, tile.label || tile.title))}>Use Front API</button> : null,
  })
}

function ServiceRow({ service, openURL, openFront }: { service: ServiceInfo; openURL: (url: string) => void; openFront?: () => void }) {
  const [status, setStatus] = useState('')
  return <details className="source-row-details"><summary className="source-row"><span className={`k-icon k-icon-${service.id} md`} aria-hidden>{service.id.slice(0, 2)}</span><span><strong>{service.name}</strong><small>{status || (service.hasToken ? `${service.account || 'token saved'} · ${service.tokenStorage === 'encrypted' ? 'keyring' : 'this run only'}` : 'no API token')}</small></span><em>manage</em></summary>
    <ServiceCard service={service} openURL={openURL} openFront={openFront} update={reload} />
    <div className="button-row"><button className="text-button" onClick={() => { void api.removeService(service.id).then(reload).then(() => setStatus(`${service.name} removed. Browser sign-ins are unchanged.`)).catch(e => setStatus(friendlyError(e))) }}>Remove {service.name} as a source</button></div>
  </details>
}

export const frontSource = serviceSource('front', 'Front', 'mail')
export const slackSource = serviceSource('slack', 'Slack', 'slack')
export const githubSource = serviceSource('github', 'GitHub', 'pr')
