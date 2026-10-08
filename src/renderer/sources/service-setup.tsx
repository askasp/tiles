import { useState } from 'react'
import type { ServiceID, ServiceInfo } from '../../shared/types'
import { KChips, KMap, KReply, KRow, type EnterRef } from '../Setup'
import { api, friendlyError } from '../data'

const serviceCopy: Record<ServiceID, { intro: string; scopes: string; map: { resource: string; tile: string; kind: 'built-in' | 'generated'; actions: string }[]; chips: { label: string; value: string; tone?: 'allow' | 'ask' | 'plain' }[] }> = {
  front: {
    intro: 'Front has a public API. Paste an API token from Front: Settings → Developers → API tokens.',
    scopes: 'Needs conversations:read and messages:read. Private inboxes need API access from an admin.',
    map: [{ resource: 'Inbox', tile: 'List of conversations', kind: 'built-in', actions: 'Show conversations · Filter · Search' }, { resource: 'Conversation', tile: 'Conversation', kind: 'built-in', actions: 'Read · Open in Front to reply' }],
    chips: [{ label: 'Read conversations', value: 'allow', tone: 'allow' }, { label: 'Reply to customers', value: 'in Front’s own page', tone: 'ask' }],
  },
  slack: {
    intro: 'Slack needs a user token (xoxp-…) from a Slack app you install: OAuth & Permissions → User Token.',
    scopes: 'users:read + im:read find existing DMs; search:read finds messages and mentions.',
    map: [{ resource: 'DM', tile: 'Slack page in a Browser tile', kind: 'built-in', actions: 'Find existing DM · never creates one' }, { resource: 'Mentions', tile: 'Search results', kind: 'built-in', actions: 'Open in Browser' }],
    chips: [{ label: 'Find DMs and mentions', value: 'allow', tone: 'allow' }, { label: 'Send messages', value: 'only in Slack’s page', tone: 'ask' }],
  },
  github: {
    intro: 'GitHub uses a personal access token: Settings → Developer settings → Fine-grained tokens, read access to the repositories you review.',
    scopes: 'Pull requests: read. Search runs only when you ask.',
    map: [{ resource: 'Pull request', tile: 'GitHub page in a Browser tile', kind: 'built-in', actions: 'Review requested · Search' }],
    chips: [{ label: 'Read pull requests', value: 'allow', tone: 'allow' }, { label: 'Comment, merge', value: 'only in GitHub’s page', tone: 'ask' }],
  },
}
/** D1/D2: a service with a ChatOS adapter, connected with a token. */
export function ServiceSetup({ id, service, changed, done, openFront, enter }: { id: ServiceID; service?: ServiceInfo; changed: (list: ServiceInfo[]) => void; done: () => void; openFront: () => void; enter?: EnterRef }) {
  const copy = serviceCopy[id]
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [account, setAccount] = useState(service?.hasToken ? service.account || 'saved token' : '')
  const name = id === 'github' ? 'GitHub' : id === 'front' ? 'Front' : 'Slack'
  const connect = async () => {
    if (busy || !token.trim()) return
    setBusy(true); setError('')
    try {
      await api.saveService({ id, token })
      setToken('')
      const result = await api.validateService(id)
      changed(await api.services())
      if (!result.ok) throw new Error(result.error || 'The token could not be verified')
      setAccount(result.account || 'verified')
    } catch (e) { setError(friendlyError(e)) } finally { setBusy(false) }
  }
  if (account) {
    if (enter) enter.current = done
    return <div className="k-panel" data-service-setup={id}>
      <KReply>Connected to {name} as {account}. This is how it will show up:</KReply>
      <KMap rows={copy.map} />
      <div className="button-row k-buttons"><button className="pill primary" onClick={done}>Keep<kbd>↵</kbd></button>{id === 'front' && <button className="pill" onClick={openFront}>Open inbox</button>}<button className="text-button" onClick={() => setAccount('')}>Replace token</button></div>
    </div>
  }
  if (enter) enter.current = () => void connect()
  return <div className="k-panel" data-service-setup={id}>
    <KReply>{copy.intro}</KReply>
    <form className="k-fields" onSubmit={e => { e.preventDefault(); void connect() }}>
      <label className="k-field"><span>API token</span><span className="k-input"><input aria-label={`${name} API token`} type="password" autoComplete="off" spellCheck={false} autoFocus value={token} onChange={e => setToken(e.target.value)} /><em className="good">{busy ? 'checking…' : ''}</em></span></label>
      <p className="k-note">{copy.scopes} Stored in your system keyring, never sent anywhere except {name}.</p>
      {error && <p className="k-error" role="alert">{error}</p>}
    </form>
    <KChips items={copy.chips} />
    <div className="k-rows"><KRow icon={id} title={busy ? 'Checking…' : `Connect ${name}`} source={name} subtitle="checks the token, then shows how it will appear" action="Connect" hint="↵" selected disabled={busy || !token.trim()} onClick={() => void connect()} /></div>
  </div>
}

