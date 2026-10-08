import { ChevronDown, ChevronUp, Copy, MessageSquare, ShieldCheck, X } from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { FormAnswer, MessageInfo, PermissionRequest, SessionDetail, SessionForm, ToolPart } from '../shared/types'
import { api, friendlyError } from './data'
import { IconButton, Status } from './ui'

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

function Permission({ request, refresh, reportError }: { request: PermissionRequest; refresh: () => void; reportError: (message: string) => void }) {
  const [pending, setPending] = useState(false)
  async function reply(decision: 'once' | 'always' | 'reject') {
    setPending(true)
    try { await api.permissionReply({ sessionID: request.sessionID, requestID: request.id, decision }); refresh() }
    catch (error) { reportError(friendlyError(error)) }
    finally { setPending(false) }
  }
  return <section className="permission-card">
    <div className="card-label"><ShieldCheck size={14} /> Permission · {request.action}</div>
    <pre>{request.resources.join('\n')}</pre>{request.message && <p>{request.message}</p>}
    <div className="button-row"><button className="pill primary" disabled={pending} onClick={() => void reply('once')}>Allow once</button>
      <button className="pill" disabled={pending} onClick={() => void reply('always')}>Always allow</button>
      <button className="pill" disabled={pending} onClick={() => void reply('reject')}>Deny</button></div>
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
      if (skip) await api.formCancel({ sessionID: form.sessionID, formID: form.id })
      else await api.formReply({ sessionID: form.sessionID, formID: form.id, answer: Object.fromEntries(fields.filter(f => f.type !== 'external' && answer[f.key] !== undefined).map(f => [f.key, answer[f.key]])) })
      refresh()
    } catch (error) { reportError(friendlyError(error)) }
    finally { setPending(false) }
  }
  return <form className="question-card" onSubmit={event => { event.preventDefault(); void reply() }}>
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

export function Chat({ detail, running, loading, older, refresh, reportError, openURL, visible = true }: {
  detail?: SessionDetail; running: boolean; loading: boolean; older: () => Promise<void>;
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
  return <div className="chat-body">
    <div className="chat-scroll" ref={scroll} onScroll={() => {
      if (!scroll.current) return
      const nearBottom = scroll.current.scrollHeight - scroll.current.scrollTop - scroll.current.clientHeight < 80
      if (!visible) return
      readingPosition.current = scroll.current.scrollTop
      follow.current = nearBottom; setAtBottom(nearBottom)
    }}>
      {detail?.messages.cursor.next && <button className="load-older" disabled={loadingOlder} onClick={() => void loadOlder()}><ChevronUp size={13} />{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button>}
      {!messages.length && <div className="empty-chat"><MessageSquare size={23} strokeWidth={1.4} /><strong>{loading ? 'Loading conversation…' : 'A fresh start'}</strong><span>{loading ? 'Connecting to this session.' : 'Tell the agent what you’d like to work on.'}</span></div>}
      <div className="messages">{[...messages].reverse().map(message => <Message message={message} key={message.id} openURL={openURL} />)}
        {detail?.permissions.map(request => <Permission key={request.id} request={request} refresh={refresh} reportError={reportError} />)}
        {detail?.forms.map(form => <AgentForm key={form.id} form={form} refresh={refresh} reportError={reportError} openURL={openURL} />)}
        {!!detail?.inbox.length && <div className="inbox-items">{detail.inbox.map(item => <div key={item.id}><span>Queued {item.type === 'user' ? 'message' : item.type}</span><span className="truncate">{String((item.payload as Record<string, unknown>)?.text || '')}</span></div>)}</div>}
        {running && <div className="agent-status"><Status running /><span>{detail?.permissions.length || detail?.forms.length ? 'Waiting for you' : 'Working…'}</span></div>}
      </div>
    </div>
    {!atBottom && <button className="jump-bottom pill" onClick={() => { follow.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }}><ChevronDown size={13} />Jump to latest</button>}
  </div>
}
