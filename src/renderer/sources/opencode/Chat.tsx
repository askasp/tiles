import { ChevronDown, Copy, MessageSquare, ShieldCheck, X } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FormAnswer, MessageInfo, PermissionRequest, SessionDetail, SessionForm, ToolPart } from '../../../shared/sources/opencode/types'
import { friendlyError, opencode } from './state'
import { Status, systemKey } from '../../ui'
import { useTileActions } from '../../actions'

const json = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2)

function Tool({ part }: { part: ToolPart }) {
  const input = part.state.input || {}
  const preview = input.command || input.path || input.filePath || input.pattern || input.url || input.description
  const output = part.state.content?.filter(content => content.type === 'text').map(content => 'text' in content ? content.text : '').join('\n')
  return <details className={`tool-row ${part.state.status === 'error' ? 'tool-error' : ''}`}>
    <summary>
      <Status running={['running', 'streaming'].includes(part.state.status)} />
      <span className="tool-name">{part.name.replace(/^functions\./, '')}</span>
      <span className="tool-preview truncate">{preview ? String(preview) : part.state.status}</span>
      <ChevronDown size={12} />
    </summary>
    <div className="tool-content"><pre>{json(input)}</pre>{output && <pre>{output}</pre>}{part.state.error && <pre className="error-text">{part.state.error}</pre>}</div>
  </details>
}

export const Message = memo(function Message({ message, openURL }: { message: MessageInfo; openURL: (url: string) => void }) {
  if (message.type === 'idle') return null
  if (message.type === 'user') return <div className="user-message"><div>{message.text}</div>
    {!!message.files?.length && <div className="message-files">{message.files.map((file, i) => <span key={i}>{file.name || 'Attachment'}</span>)}</div>}
  </div>
  if (message.type === 'assistant') return <div className="assistant-message">
    {message.content?.map((part, index) => part.type === 'tool' ? <Tool part={part} key={part.id} />
      : part.type === 'reasoning' ? <details className="reasoning" key={index}><summary>Thinking <ChevronDown size={11} /></summary><div>{part.text}</div></details>
      : <div className="markdown" key={index}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href && /^https?:\/\//.test(href)) openURL(href) }}>{children}</a>,
        img: ({ alt }) => <span className="inline-image-label">{alt || 'Image'}</span>,
      }}>{part.text}</ReactMarkdown></div>)}
    {!!message.error && <div className="inline-error">{json(message.error)}</div>}
  </div>
  if (message.type === 'shell') return <pre className="shell-message">{message.text}</pre>
  if (message.type === 'system' || message.type === 'synthetic') return <div className="system-message">{message.description || message.text}</div>
  if (message.type === 'compaction') return <div className="system-message">Context compacted</div>
  if (['agent-switched', 'model-switched', 'location-switched'].includes(message.type)) return null
  return message.text ? <div className="system-message">{message.text}</div> : null
})

/** Answered with y / a / n (the tile's actions), or from the action menu, where it comes first. */
function Permission({ request, pending }: { request: PermissionRequest; pending: boolean }) {
  return <section className="permission-card" aria-label={`Permission · ${request.action}`}>
    <div className="card-label"><ShieldCheck size={14} /> Permission · {request.action}</div>
    <pre>{request.resources.join('\n')}</pre>{request.message && <p>{request.message}</p>}
    <div className="permission-keys">{pending ? 'Answering…' : <><span><kbd>y</kbd> Allow once</span><span><kbd>a</kbd> Always allow</span><span><kbd>n</kbd> Deny</span><span className="muted">from the message box: Esc first, or {systemKey}+.</span></>}</div>
  </section>
}

function AgentForm({ form, refresh, reportError, openURL }: { form: SessionForm; refresh: () => void; reportError: (message: string) => void; openURL: (url: string) => void }) {
  const [answer, setAnswer] = useState<FormAnswer>(() => Object.fromEntries(form.fields
    .filter(field => field.default !== undefined || field.type === 'boolean' || field.type === 'multiselect')
    .map(field => [field.key, field.default ?? (field.type === 'boolean' ? false : [])])) as FormAnswer)
  const [pending, setPending] = useState(false)
  const fields = form.fields.filter(field => !field.hidden && (!field.when || field.when.every(condition => condition.op === 'eq' ? answer[condition.key] === condition.value : answer[condition.key] !== condition.value)))
  async function reply(skip = false) {
    setPending(true)
    try {
      if (skip) await opencode.formCancel({ sessionID: form.sessionID, formID: form.id })
      else await opencode.formReply({ sessionID: form.sessionID, formID: form.id, answer: Object.fromEntries(fields.filter(f => f.type !== 'external' && answer[f.key] !== undefined).map(f => [f.key, answer[f.key]])) })
      refresh()
    } catch (error) { reportError(friendlyError(error)) }
    finally { setPending(false) }
  }
  return <form className="question-card" data-form-id={form.id} onSubmit={event => { event.preventDefault(); void reply() }}>
    <div className="card-label"><MessageSquare size={14} /> Question from the agent</div><strong>{form.title}</strong>
    {fields.map(field => <label className="form-field" key={field.key}>
      <span>{field.title || field.key}{field.required && ' *'}</span>{field.description && <small>{field.description}</small>}
      {field.type === 'external' ? <button type="button" className="pill" onClick={() => field.url && openURL(field.url)}>Open link</button>
        : field.type === 'boolean' ? <input type="checkbox" checked={!!answer[field.key]} onChange={event => setAnswer({ ...answer, [field.key]: event.target.checked })} />
        : field.type === 'multiselect' ? <div className="form-options">{field.options?.map(option => <label key={option.value}><input type="checkbox" checked={(answer[field.key] as string[] || []).includes(option.value)} onChange={event => setAnswer({ ...answer, [field.key]: event.target.checked ? [...(answer[field.key] as string[] || []), option.value] : (answer[field.key] as string[] || []).filter(value => value !== option.value) })} />{option.label}</label>)}</div>
        : field.options?.length && !field.custom ? <select required={field.required} value={answer[field.key] as string || ''} onChange={event => setAnswer({ ...answer, [field.key]: event.target.value })}><option value="">Choose…</option>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <><input type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} step={field.type === 'integer' ? 1 : 'any'} required={field.required} placeholder={field.placeholder} minLength={field.minLength} maxLength={field.maxLength} list={field.options ? `${form.id}-${field.key}` : undefined} value={answer[field.key] as string | number ?? ''} onChange={event => setAnswer({ ...answer, [field.key]: ['number', 'integer'].includes(field.type) ? Number(event.target.value) : event.target.value })} />{field.options && <datalist id={`${form.id}-${field.key}`}>{field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist>}</>}
    </label>)}
    <div className="button-row"><button className="pill primary" disabled={pending} type="submit">Reply</button><button className="pill" disabled={pending} type="button" onClick={() => void reply(true)}>Skip</button></div>
  </form>
}

export function Chat({ tileID, detail, running, loading, older, refresh, reportError, openURL, visible = true }: {
  tileID: string; detail?: SessionDetail; running: boolean; loading: boolean; older: () => Promise<void>;
  refresh: () => void; reportError: (message: string) => void; openURL: (url: string) => void;
  visible?: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const readingPosition = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const messages = detail?.messages.data || []
  useLayoutEffect(() => {
    if (!visible || !scroll.current) return
    scroll.current.scrollTop = follow.current ? scroll.current.scrollHeight : readingPosition.current
  }, [detail, visible])
  useEffect(() => { follow.current = true; setAtBottom(true) }, [detail?.session.id])
  async function loadOlder() {
    const height = scroll.current?.scrollHeight || 0
    const top = scroll.current?.scrollTop || 0
    follow.current = false; setLoadingOlder(true)
    try {
      await older()
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = top + scroll.current.scrollHeight - height })
    } catch (error) { reportError(friendlyError(error)) }
    finally { setLoadingOlder(false) }
  }
  const [answering, setAnswering] = useState<string>()
  const permission = detail?.permissions[0], form = detail?.forms[0]
  async function reply(request: PermissionRequest, decision: 'once' | 'always' | 'reject') {
    setAnswering(request.id)
    try { await opencode.permissionReply({ sessionID: request.sessionID, requestID: request.id, decision }); refresh() }
    catch (error) { reportError(friendlyError(error)) }
    finally { setAnswering(undefined) }
  }
  const latest = () => { follow.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }
  useTileActions(tileID, 'opencode-chat', [
    ...(permission ? [
      { id: 'allow', label: `Allow once · ${permission.action}`, key: 'y', urgent: true, disabled: !!answering, run: () => void reply(permission, 'once') },
      { id: 'always', label: `Always allow · ${permission.action}`, key: 'a', urgent: true, disabled: !!answering, run: () => void reply(permission, 'always') },
      { id: 'deny', label: `Deny · ${permission.action}`, key: 'n', urgent: true, disabled: !!answering, run: () => void reply(permission, 'reject') },
    ] : []),
    ...(form ? [{ id: 'form', label: `Answer · ${form.title || 'the agent’s question'}`, key: 'r', urgent: true, run: () => scroll.current?.querySelector<HTMLElement>(`[data-form-id="${form.id}"] input, [data-form-id="${form.id}"] select, [data-form-id="${form.id}"] button`)?.focus() }] : []),
    ...(detail?.messages.cursor.next ? [{ id: 'older', label: 'Load earlier messages', key: 'e', disabled: loadingOlder, run: () => void loadOlder() }] : []),
    { id: 'latest', label: 'Jump to the latest', key: 'G', run: latest },
    { id: 'scroll', label: 'Scroll the conversation', keyLabel: 'PgUp PgDn', run: () => scroll.current?.scrollBy({ top: -scroll.current.clientHeight * 0.8 }) },
  ])
  // PgUp/PgDn scroll the conversation from anywhere in the tile, the message box included.
  useEffect(() => {
    const tile = scroll.current?.closest<HTMLElement>('[data-tile-id]')
    if (!tile) return
    const keys = (event: KeyboardEvent) => {
      if ((event.key !== 'PageUp' && event.key !== 'PageDown') || !scroll.current) return
      event.preventDefault(); scroll.current.scrollBy({ top: (event.key === 'PageDown' ? 1 : -1) * scroll.current.clientHeight * 0.8 })
    }
    tile.addEventListener('keydown', keys)
    return () => tile.removeEventListener('keydown', keys)
  }, [])
  return <div className="chat-body">
    <div className="chat-scroll" ref={scroll} onScroll={() => {
      if (!scroll.current) return
      const nearBottom = scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight < 80
      if (!visible) return
      readingPosition.current = scroll.current.scrollTop
      follow.current = nearBottom; setAtBottom(nearBottom)
    }}>
      {detail?.messages.cursor.next && <div className="load-older">{loadingOlder ? 'Loading…' : <><kbd>e</kbd> earlier messages</>}</div>}
      {!messages.length && <div className="empty-chat"><MessageSquare size={23} strokeWidth={1.4} /><strong>{loading ? 'Loading conversation…' : 'A fresh start'}</strong><span>{loading ? 'Connecting to this session.' : 'Tell the agent what you’d like to work on.'}</span></div>}
      <div className="messages">{[...messages].reverse().map(message => <Message message={message} key={message.id} openURL={openURL} />)}
        {detail?.permissions.map(request => <Permission key={request.id} request={request} pending={answering === request.id} />)}
        {detail?.forms.map(form => <AgentForm key={form.id} form={form} refresh={refresh} reportError={reportError} openURL={openURL} />)}
        {!!detail?.inbox.length && <div className="inbox-items">{detail.inbox.map(item => <div key={item.id}><span>Queued {item.type === 'user' ? 'message' : item.type}</span><span className="truncate">{String((item.payload as Record<string, unknown>)?.text || '')}</span></div>)}</div>}
        {running && <div className="agent-status"><Status running /><span>{detail?.permissions.length || detail?.forms.length ? 'Waiting for you' : 'Working…'}</span></div>}
      </div>
    </div>
    {!atBottom && <div className="jump-bottom pill"><ChevronDown size={13} /><kbd>G</kbd> latest</div>}
  </div>
}
