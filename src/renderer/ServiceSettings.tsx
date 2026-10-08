import { ExternalLink, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FrontIdentity, ServiceInfo } from '../shared/types'
import { api, friendlyError } from './data'

export function ServiceSettings({ openURL, onChange, openFront }: { openURL: (url: string) => void; onChange: (services: ServiceInfo[]) => void; openFront?: () => void }) {
  const [services, setServices] = useState<ServiceInfo[]>([])
  const [error, setError] = useState('')
  useEffect(() => { void api.services().then(setServices).catch(e => setError(friendlyError(e))) }, [])
  const update = async () => { const items = await api.services(); setServices(items); onChange(items) }
  return <div className="service-settings"><h3><ShieldCheck size={16} />Accounts & authentication</h3><p className="muted">Sign in to web tiles with your normal provider login/SSO. Browser cookies are shared across this desktop and survive tile moves. API tokens are separate: they do not log you into a web page.</p>
    {error && <div className="inline-error">{error}</div>}
    {services.map(service => <ServiceCard key={service.id} service={service} openURL={openURL} update={update} openFront={openFront} />)}
    <p className="auth-scope-note">App-level OAuth needs registered Slack/Front/GitHub apps, client IDs and redirect URLs. Front lists and messages can use API-native tiles with a token, without browser login. Slack/GitHub bodies and external replies still use web tiles. Verification only checks account identity, not every required read scope.</p>
  </div>
}
export function ServiceCard({ service, openURL, update, openFront }: { service: ServiceInfo; openURL: (url: string) => void; update: () => Promise<void>; openFront?: () => void }) {
  const [url, setURL] = useState(service.url)
  const [token, setToken] = useState('')
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState(false)
  const [identity, setIdentity] = useState<FrontIdentity>(service.front || { email: '', teammateID: '', tagID: '' })
  const act = async (action: () => Promise<void>) => { setPending(true); setStatus(''); try { await action(); await update() } catch (e) { setStatus(friendlyError(e)) } finally { setPending(false) } }
  return <section className="service-card"><div className="service-card-heading"><strong>{service.name}</strong><span>{service.hasToken ? `Token · ${service.tokenStorage === 'encrypted' ? 'OS-encrypted' : 'this run only'}` : 'No API token'}</span></div>
    <label className="form-field">Home / workspace URL<input aria-label={`${service.name} URL`} type="url" value={url} onChange={e => setURL(e.target.value)} /></label>
    <div className="button-row"><button className="pill" disabled={pending} onClick={() => void act(async () => { const saved = await api.saveService({ id: service.id, url }); openURL(saved.url) })}><ExternalLink size={13} />Sign in to {service.name}</button><button className="text-button" disabled={pending} onClick={() => void act(async () => { await api.saveService({ id: service.id, url }); setStatus('URL saved.') })}>Save URL</button></div>
    <label className="form-field">API token (optional)<input aria-label={`${service.name} API token`} type="password" autoComplete="off" spellCheck={false} placeholder={service.hasToken ? 'Saved · enter a replacement' : 'Paste a scoped token'} value={token} onChange={e => setToken(e.target.value)} /></label>
    <p className="auth-scope-note">{service.id === 'slack' ? 'Use a user token: users:read + im:read for existing DMs; search:read for messages/mentions. No DM is created by search.' : service.id === 'front' ? 'Native lists need conversations:read; native message bodies also need messages:read. Private inboxes require API access permission. No mail is changed.' : 'Use a token with access to the repositories you review. Discovery only reads PR search results.'}</p>
    {!service.secureStorage && <p className="auth-warning">OS secret storage is unavailable. Tokens stay in memory for this run only; plaintext tokens are never written to disk.</p>}
    <div className="button-row"><button className="pill" disabled={pending || !token.trim()} onClick={() => void act(async () => { await api.saveService({ id: service.id, url, token }); setToken(''); setStatus('Token saved. Verify to check the account.') })}><KeyRound size={12} />Save token</button><button className="text-button" disabled={pending || !service.hasToken} onClick={() => void act(async () => { const result = await api.validateService(service.id); setStatus(result.ok ? `Verified: ${result.account}` : result.error || 'Verification failed') })}>Verify token</button><button className="text-button" disabled={pending || !service.hasToken} onClick={() => void act(async () => { await api.disconnectService(service.id); setToken(''); setStatus('API token removed. Browser login is unchanged.') })}><LogOut size={12} />Remove token</button></div>
    {service.id === 'front' && <div className="front-identity"><h4>Personal mail filters (optional)</h4><label className="form-field">Your email<input aria-label="Front filter email" type="email" value={identity.email} onChange={e => setIdentity(v => ({ ...v, email: e.target.value }))} /></label><label className="form-field">Your Front teammate ID<input aria-label="Front teammate ID" placeholder="tea_…" value={identity.teammateID} onChange={e => setIdentity(v => ({ ...v, teammateID: e.target.value }))} /></label><label className="form-field">Your tag ID<input aria-label="Front tag ID" placeholder="tag_…" value={identity.tagID} onChange={e => setIdentity(v => ({ ...v, tagID: e.target.value }))} /></label><p className="auth-scope-note">These enable addressed, assigned, mentioned, tagged and replies-to-my-mail tiles. Front needs teammate/tag IDs, not names. Replies means conversations you authored whose latest message is inbound—not a since-last-seen feed.</p><div className="button-row"><button className="pill" disabled={pending} onClick={() => void act(async () => { await api.saveService({ id: 'front', front: identity }); setStatus('Front mail filters saved.') })}>Save mail filters</button>{openFront && <button className="pill primary" disabled={pending} onClick={openFront}>Open Front API inbox</button>}</div></div>}
    {status && <p className="auth-status" role="status">{status}</p>}
  </section>
}
