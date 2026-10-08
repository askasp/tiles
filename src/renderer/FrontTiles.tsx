import { ExternalLink, Mail, Paperclip, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FrontDetail, FrontPage, ServiceInfo } from '../shared/types'
import type { OpenMode, Tile, TileInput } from '../shared/tiles'
import { frontConversationTile, frontInboxTile } from '../shared/tiles'
import { frontFilters } from '../shared/front'
import { api, friendlyError } from './data'
import { IconButton } from './ui'

function AuthNotice({ settings }: { settings: () => void }) {
  return <div className="front-empty"><Mail size={28} /><h3>Front, without the browser</h3><p>Save your Front token in Settings. Conversation lists need <code>conversations:read</code>; messages also need <code>messages:read</code>. Your token must have access to the selected inbox.</p><button className="pill primary" onClick={settings}>Front account settings</button></div>
}

export function FrontInbox({ tile, visible, account, open, settings, web }: {
  tile: Tile; visible: boolean; account?: ServiceInfo; open: (input: TileInput, mode?: OpenMode) => void; settings: () => void; web: () => void;
}) {
  const [query, setQuery] = useState(tile.frontQuery || '')
  const [page, setPage] = useState<FrontPage>({ items: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  const generation = useRef(0)
  const rows = useRef<HTMLDivElement>(null)
  const refresh = useCallback(async (cursor?: string) => {
    if (!account?.hasToken) return
    const revision = ++generation.current
    setLoading(true); setError('')
    try {
      const result = await api.frontConversations({ query: tile.frontQuery || '', cursor })
      if (revision !== generation.current) return
      setPage(previous => cursor ? { ...result, items: [...previous.items, ...result.items.filter(c => !previous.items.some(p => p.id === c.id))] } : result)
      if (!cursor) setSelected(0)
    } catch (e) { if (revision === generation.current) setError(friendlyError(e)) }
    finally { if (revision === generation.current) setLoading(false) }
  }, [account, tile.frontQuery])
  useEffect(() => {
    if (!account?.hasToken) { setPage({ items: [] }); setError(''); setLoading(false) }
    if (visible) void refresh()
    return () => { generation.current++ }
  }, [visible, refresh, account?.hasToken])
  useEffect(() => { rows.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' }) }, [selected])
  const choose = (index: number, mode: OpenMode = 'here') => { const item = page.items[index]; if (item) open(frontConversationTile(item.id, item.subject), mode) }
  return <div className="front-inbox">
    <div className="front-toolbar"><strong>Front API</strong><IconButton label="Refresh Front inbox" disabled={loading || !account?.hasToken} onClick={() => void refresh()}><RefreshCw size={14} /></IconButton><button className="text-button" onClick={web}><ExternalLink size={13} />Front web</button></div>
    {!account?.hasToken ? <AuthNotice settings={settings} /> : <>
      <form className="front-search" onSubmit={e => { e.preventDefault(); open(frontInboxTile(query)) }}><Search size={15} /><input aria-label="Front conversation filter" placeholder="to:you@example.com · mention:tea_… · tag:tag_…" value={query} onChange={e => setQuery(e.target.value)} /><button className="pill" type="submit">Open filter</button></form>
      <div className="front-presets">{frontFilters(account.front).map(filter => <button className="pill" key={filter.title} disabled={!filter.ready} title={filter.ready ? filter.query : 'Set your email, teammate ID or tag ID in Front settings'} onClick={() => open(frontInboxTile(filter.query, `Front · ${filter.title}`))}>{filter.title}</button>)}<button className="text-button" onClick={settings}>Configure “me”</button></div>
      <div className="front-filter-note">{tile.frontQuery || 'All accessible conversations'} · ↑/↓ select · Enter open · Shift+Enter move here<br />Filters are saved as separate unique tiles; reading does not mark mail read.</div>
      {error && <div className="inline-error" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
      <div className="front-results" ref={rows} tabIndex={0} data-arrow-keys role="list" aria-label="Front conversations" onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(0, Math.min(page.items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))) }
        if (e.key === 'Enter') { e.preventDefault(); choose(selected, e.shiftKey ? 'move' : e.ctrlKey ? 'new' : 'here') }
      }}>{page.items.map((item, index) => <button key={item.id} className={`front-conversation-row ${index === selected ? 'selected' : ''}`} onFocus={() => setSelected(index)} onMouseEnter={() => setSelected(index)} onClick={e => choose(index, e.shiftKey ? 'move' : e.ctrlKey ? 'new' : 'here')}><span className="front-row-heading"><strong>{item.subject}</strong><small>{item.status}</small></span><span className="front-row-sender">{item.sender}{item.assignee && ` · Assigned to ${item.assignee}`}</span>{item.preview && <span className="front-row-preview">{item.preview}</span>}<span className="front-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</span></button>)}
        {loading && <p className="empty-list">Loading conversations…</p>}{!loading && !error && !page.items.length && <p className="empty-list">No conversations match this filter in the inboxes accessible to your token.</p>}
        {!!page.next && <button className="pill load-more" disabled={loading} onClick={() => void refresh(page.next)}>More conversations</button>}
      </div>
      <footer className="front-footer">Read-only · no browser login needed · replies currently use Front web</footer>
    </>}
  </div>
}

export function FrontConversationBody({ tile, visible, account, settings, web, change }: {
  tile: Tile; visible: boolean; account?: ServiceInfo; settings: () => void; web: () => void; change: (patch: Partial<Tile>) => void;
}) {
  const [sending, setSending] = useState<'reply' | 'comment'>(), [notice, setNotice] = useState('')
  const [detail, setDetail] = useState<FrontDetail>()
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  const refresh = useCallback(async (cursor?: string) => {
    if (!account?.hasToken) return
    const revision = ++generation.current; setLoading(true); setError('')
    try {
      const result = await api.frontConversation({ id: tile.conversationID!, cursor })
      if (revision !== generation.current) return
      setDetail(previous => cursor && previous ? { ...result, messages: [...previous.messages, ...result.messages.filter(m => !previous.messages.some(p => p.id === m.id))] } : result)
    } catch (e) { if (revision === generation.current) setError(friendlyError(e)) }
    finally { if (revision === generation.current) setLoading(false) }
  }, [account, tile.conversationID])
  const write = async (kind: 'reply' | 'comment') => {
    const body = tile.draft
    if (!body.trim() || sending) return
    setSending(kind); setNotice(''); setError('')
    try {
      await api.frontWrite({ id: tile.conversationID!, kind, body })
      // Clear only the text that was sent; later edits stay.
      change({ draft: '' })
      setNotice(kind === 'reply' ? 'Reply sent.' : 'Comment added.')
      void refresh()
    } catch (e) { setError(friendlyError(e)) } finally { setSending(undefined) }
  }
  useEffect(() => {
    if (!account?.hasToken) { setDetail(undefined); setError(''); setLoading(false) }
    if (visible) void refresh()
    return () => { generation.current++ }
  }, [visible, refresh, account?.hasToken])
  return <div className="front-conversation">
    <div className="front-toolbar"><strong>Front API · conversation</strong><IconButton label="Refresh Front conversation" disabled={loading || !account?.hasToken} onClick={() => void refresh()}><RefreshCw size={14} /></IconButton><button className="text-button" onClick={web}><ExternalLink size={13} />Open in Front / reply</button></div>
    {!account?.hasToken ? <AuthNotice settings={settings} /> : <>
      {error && <div className="inline-error" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
      <div className="front-message-scroll" tabIndex={0}>
        {detail && <header className="front-thread-summary"><h2>{detail.conversation.subject}</h2><p>{detail.conversation.status}{detail.conversation.assignee && ` · Assigned to ${detail.conversation.assignee}`}</p><span className="front-tags">{detail.conversation.tags.map(tag => <span key={tag}>{tag}</span>)}</span></header>}
        {detail?.messages.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(message => <article className="front-message" key={message.id}>
          <header><strong>{message.inbound ? 'Received' : 'Sent'}{message.draft && ' · Draft'}</strong><time>{message.createdAt ? new Date(message.createdAt).toLocaleString() : ''}</time></header>
          <dl>{message.recipients.map((r, index) => <div key={index}><dt>{r.role}</dt><dd>{r.name ? `${r.name} <${r.handle}>` : r.handle}</dd></div>)}</dl>
          <div className="front-message-text">{message.text || '(No text body)'}</div>
          {!!message.attachments.length && <div className="front-attachments">{message.attachments.map((attachment, index) => <span key={index}><Paperclip size={12} />{attachment.name}{attachment.size ? ` · ${Math.ceil(attachment.size / 1024)} KB` : ''}</span>)}<small>Open Front web to download attachments.</small></div>}
        </article>)}
        {detail?.next && <button className="pill load-more" disabled={loading} onClick={() => void refresh(detail.next)}>Older messages</button>}
        {loading && <p className="empty-list">Loading messages…</p>}{detail && !loading && !detail.messages.length && <p className="empty-list">No messages were returned for this conversation.</p>}
      </div>
      <form className="front-reply" onSubmit={e => e.preventDefault()}>
        <textarea aria-label="Front reply draft" placeholder={`Reply to ${detail?.conversation.sender || 'the conversation'}, or comment for your team…`} value={tile.draft} onChange={e => change({ draft: e.target.value })} rows={2} />
        <div className="button-row">{notice && <span className="muted" role="status">{notice}</span>}<button type="button" className="pill" disabled={!!sending || !tile.draft.trim()} onClick={() => void write('comment')}>{sending === 'comment' ? 'Commenting…' : 'Comment · confirm…'}</button><button type="button" className="pill primary" disabled={!!sending || !tile.draft.trim()} onClick={() => void write('reply')}>{sending === 'reply' ? 'Sending…' : 'Reply · confirm…'}</button></div>
      </form>
      <footer className="front-footer">Latest first · remote images blocked · every reply and comment asks first · attachments in Front web</footer>
    </>}
  </div>
}
