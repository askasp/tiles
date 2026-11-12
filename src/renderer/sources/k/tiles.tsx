import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { chatTile, isQuick, latest, type Artifact, type Chat, type ChatTurn } from '../../../shared/sources/k'
import type { Tile } from '../../../shared/tiles'
import { isLive, tileTitle } from '../../../shared/tiles'
import type { ContextItem } from '../../../shared/types'
import { uid } from '../../../shared/util'
import { api, friendlyError } from '../../data'
import { KeyHints, Status, filterField, groupOf, useWide, when, whenLong } from '../../ui'
import { useTileActions } from '../../actions'
import { iconText } from '../../Setup'
import { listOpen, type Env, type PanelProps } from '../types'
import type { KState } from './state'

export function Markdown({ text, openURL }: { text: string; openURL: (url: string) => void }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => <a href={href} onClick={event => { event.preventDefault(); if (href && /^https?:\/\//.test(href)) openURL(href) }}>{children}</a>,
    img: ({ alt }) => <span className="inline-image-label">{alt || 'Image'}</span>,
  }}>{text}</ReactMarkdown></div>
}

const turnCount = (chat: Chat) => chat.turns.filter(t => !t.error).length
const artifactsLine = (chat: Chat) => chat.artifacts.length === 1 ? `1 artifact${chat.artifacts[0].versions.length > 1 ? `, v${chat.artifacts[0].versions.length}` : ''}` : chat.artifacts.length ? `${chat.artifacts.length} artifacts` : ''

function ArtifactCard({ artifact, version, open, current }: { artifact?: Artifact; version: number; open: () => void; current: boolean }) {
  if (!artifact) return null
  const v = artifact.versions[version - 1]
  return <button className="k-artifact-card" onClick={open}><span className="k-icon k-icon-doc" aria-hidden>doc</span>
    <span className="k-artifact-card-copy"><strong className="truncate">{artifact.title}</strong><small>Document · v{version}{v ? ` · ${when(v.time)}` : ''}</small></span>
    <span className="k-artifact-card-action">{current ? 'Open beside →' : 'Open ↵'}</span></button>
}

function Turn({ turn, chat, state, env }: { turn: ChatTurn; chat: Chat; state: KState; env: Env }) {
  if (turn.role === 'user') return <div className="k-turn user"><div className="k-bubble">{turn.text}</div>{!!turn.context?.length && <div className="k-turn-context">{turn.context.map(c => <span key={c}>@ {c}</span>)}</div>}</div>
  const artifact = turn.artifact && chat.artifacts.find(a => a.id === turn.artifact!.id)
  return <div className={`k-turn k ${turn.error ? 'error' : ''}`}>{turn.error ? <div className="inline-error">{turn.text}</div> : <Markdown text={turn.text} openURL={url => env.openURL(url)} />}
    {turn.artifact && <ArtifactCard artifact={artifact} version={turn.artifact.version} current={!!artifact && artifact.versions.length === turn.artifact.version} open={() => state.openArtifact(turn.artifact!.id)} />}</div>
}

/** What a tile tells K when you point at it with @. Pages, files and documents give their text. */
async function contextFor(tile: Tile, state: KState): Promise<ContextItem> {
  const name = tileTitle(tile), item = (text: string): ContextItem => ({ id: uid(), kind: 'page', name, text })
  if (tile.kind === 'browser') { const page = await api.browserContext(tile.id); return item(`URL: ${page.url}\n\n${page.text}`) }
  if (tile.kind === 'file' && tile.path) { const file = await api.readTextFile(tile.path); return item(`File: ${tile.path}\n\n${file.text || file.reason || '(not a text file)'}`) }
  if (tile.kind === 'artifact') { const a = state.chats.flatMap(c => c.artifacts).find(a => a.id === tile.ref); return item(a ? latest(a).text : name) }
  if (tile.kind === 'chat') { const c = state.byID[tile.ref!]; return item(c ? c.turns.slice(-20).map(t => `${t.role === 'user' ? 'Person' : 'K'}: ${t.text}`).join('\n\n') : name) }
  return item(`${tile.kind} tile: ${name}${tile.directory ? ` · ${tile.directory}` : tile.url ? ` · ${tile.url}` : tile.path ? ` · ${tile.path}` : ''}`)
}

/** The reply box. @ points K at a tile: its text goes along as context. ↵ sends, Shift+↵ a new line, Esc leaves. */
function Composer({ tile, state, env, focused, focusKey, send, disabled }: { tile: Tile; state: KState; env: Env; focused: boolean; focusKey: number; send: () => void; disabled: boolean }) {
  const area = useRef<HTMLTextAreaElement>(null)
  const [choice, setChoice] = useState(0)
  const [caret, setCaret] = useState(0)
  useEffect(() => { if (focused && focusKey) area.current?.focus() }, [focused, focusKey])
  const mention = tile.draft.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/)
  const others = mention ? env.desktop.tiles.filter(t => t.id !== tile.id && isLive(t) && tileTitle(t).toLowerCase().includes(mention[1].toLowerCase())).sort((a, b) => Number(b.status === 'visible') - Number(a.status === 'visible') || b.lastUsed - a.lastUsed).slice(0, 6) : []
  const choose = async (other: Tile) => {
    const start = caret - mention![1].length - 1
    env.changeTile(tile.id, { draft: `${tile.draft.slice(0, start)}${tile.draft.slice(caret)}` })
    try { const item = await contextFor(other, state); const now = env.desktop.tiles.find(t => t.id === tile.id); env.changeTile(tile.id, { context: [...(now?.context || []), item] }) }
    catch (e) { env.reportError(friendlyError(e)) }
    area.current?.focus()
  }
  return <div className="k-composer">
    {!!others.length && <div className="k-mentions" role="listbox" aria-label="Point K at a tile">{others.map((t, i) => <button key={t.id} role="option" aria-selected={i === choice} className={i === choice ? 'selected' : ''} onMouseDown={e => { e.preventDefault(); void choose(t) }}><span className="truncate">{tileTitle(t)}</span><small>{t.kind}{t.status === 'hidden' ? ' · hidden' : ''}</small></button>)}</div>}
    {!!tile.context.length && <div className="k-context">{tile.context.map(c => <span key={c.id} className="k-context-chip">@ {c.name}<button aria-label={`Remove ${c.name}`} onClick={() => env.changeTile(tile.id, { context: tile.context.filter(x => x.id !== c.id) })}>×</button></span>)}</div>}
    <div className="k-composer-box"><textarea ref={area} className="k-composer-input" aria-label="Reply to K" rows={1} placeholder={state.ready ? 'Reply… @ to point at a tile' : 'Connect a model to talk to K'} value={tile.draft} disabled={!state.ready}
      onChange={e => { env.changeTile(tile.id, { draft: e.target.value }); setCaret(e.target.selectionStart); setChoice(0) }} onSelect={e => setCaret(e.currentTarget.selectionStart)}
      onKeyDown={e => {
        if (e.nativeEvent.isComposing) return
        if (others.length && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setChoice(c => (c + (e.key === 'ArrowDown' ? 1 : others.length - 1)) % others.length); return }
        if (others.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); void choose(others[Math.min(choice, others.length - 1)]); return }
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (!disabled) send(); return }
        if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.closest<HTMLElement>('[data-tile-id]')?.focus() }
      }} /><kbd aria-hidden>↵</kbd></div>
  </div>
}

export function ChatBody({ tile, state, env, focused, focusKey }: { tile: Tile; state: KState; env: Env; focused: boolean; focusKey: number }) {
  const id = tile.ref!, chat = state.byID[id], pending = state.pending.includes(id)
  const list = useRef<HTMLDivElement>(null)
  const document = chat?.artifacts[chat.artifacts.length - 1]
  useLayoutEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight }, [chat?.turns.length, pending])
  useEffect(() => { if (chat && !chat.tile) state.markTiled(id) }, [chat?.tile, id]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => {
    const text = tile.draft.trim(), context = tile.context
    if ((!text && !context.length) || pending) return
    env.changeTile(tile.id, { draft: '', context: [] })
    void state.ask(id, text || 'Look at this.', context)
  }
  useTileActions(tile.id, 'k-chat', [
    { id: 'document', key: 'd', label: document ? `Update “${document.title}” from this chat` : 'Make it a document', disabled: !state.ready || pending || !chat?.turns.length, run: () => void state.ask(id, document ? 'Update the document with what we just discussed.' : 'Make it a document.') },
    { id: 'artifact', key: 'a', label: document ? `Open “${document.title}”` : 'Open its document (none yet)', disabled: !document, run: () => { if (document) state.openArtifact(document.id) } },
    { id: 'delete', key: 'D', keyLabel: 'Delete', label: 'Delete this chat…', disabled: !chat, run: () => void state.remove(id) },
  ])
  return <div className="k-chat">
    <div className="k-chat-turns" ref={list}>
      {!chat?.turns.length && <div className="k-chat-empty">Ask K anything. <kbd>@</kbd> points it at a tile; what it makes opens beside this chat.</div>}
      {chat?.turns.map(t => <Turn key={t.id} turn={t} chat={chat} state={state} env={env} />)}
      {pending && <div className="k-thinking"><Status running /> K is thinking…</div>}
    </div>
    <Composer tile={tile} state={state} env={env} focused={focused} focusKey={focusKey} send={send} disabled={pending} />
  </div>
}

/** A document K made. Every edit is a new version of the same artifact; Edit in chat goes back to the thread. */
export function ArtifactBody({ tile, state, env }: { tile: Tile; state: KState; env: Env }) {
  const chat = state.chats.find(c => c.artifacts.some(a => a.id === tile.ref)), artifact = chat?.artifacts.find(a => a.id === tile.ref)
  const [shown, setShown] = useState<number>()
  const count = artifact?.versions.length || 0
  // A new version shows itself; looking back at an older one stays put until then.
  useEffect(() => { setShown(undefined) }, [count])
  const index = Math.min(shown ?? count - 1, count - 1), version = artifact?.versions[index]
  const copy = () => { if (version) void navigator.clipboard.writeText(version.text).then(() => env.notify(`Copied v${index + 1} of “${artifact!.title}”.`)).catch(e => env.reportError(friendlyError(e))) }
  const edit = () => { if (chat) state.continueInTile(chat.id) }
  useTileActions(tile.id, 'k-artifact', [
    { id: 'edit', key: 'e', label: 'Edit in chat', disabled: !chat, run: edit },
    { id: 'copy', key: 'c', label: 'Copy', disabled: !version, run: copy },
    { id: 'older', key: '[', label: 'Older version', disabled: index <= 0, run: () => setShown(index - 1) },
    { id: 'newer', key: ']', label: 'Newer version', disabled: index >= count - 1, run: () => setShown(index + 1) },
  ])
  if (!artifact || !version) return <div className="empty-list">This document is no longer here. Its chat was deleted.</div>
  return <div className="k-artifact">
    <div className="k-artifact-bar">
      {index === count - 1 && count > 1 && <span className="k-new">new</span>}<span className="k-version current">v{index + 1}</span>
      {artifact.versions.map((v, i) => i !== index && <button key={i} className="k-version" onClick={() => setShown(i)}>v{i + 1} · {when(v.time)}</button>)}
      <span className="k-artifact-from truncate">from {chat!.title}</span>
      <button className="text-button" onClick={edit}><kbd>e</kbd> Edit in chat</button><button className="text-button" onClick={copy}><kbd>c</kbd> Copy</button>
    </div>
    <article className="k-artifact-page"><Markdown text={version.text} openURL={url => env.openURL(url, tile.id)} /></article>
  </div>
}

const LIST_PEEK_WIDTH = 1100
/** Chats as a list: by day, quick asks in their own muted group, artifacts with each chat. Wide: a peek. */
export function ChatsBody({ tile, state, env }: { tile: Tile; state: KState; env: Env }) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string>()
  const root = useRef<HTMLDivElement>(null)
  const wide = useWide(root, LIST_PEEK_WIDTH)
  const f = filter.toLowerCase()
  const chats = state.chats.filter(c => !f || c.title.toLowerCase().includes(f) || c.artifacts.some(a => a.title.toLowerCase().includes(f)))
  const groups: { label: string; chats: Chat[]; muted?: boolean }[] = []
  const add = (label: string, chat: Chat, muted?: boolean) => { const g = groups.find(g => g.label === label); if (g) g.chats.push(chat); else groups.push({ label, chats: [chat], muted }) }
  for (const c of chats) { const day = groupOf(c.updated); if (isQuick(c) && day === 'Today') add('Quick', c, true); else add(day, c) }
  const order = ['Today', 'Quick', 'Yesterday', 'This week', 'Older']
  groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
  const current = chats.find(c => c.id === selected) || chats[0]
  const placed = (id: string) => { const t = env.desktop.tiles.find(t => t.kind === 'chat' && t.ref === id && t.status === 'visible'); const w = t && env.desktop.workspaces.find(w => w.id === t.workspaceID); return w ? `on ${w.slot}` : '' }
  const document = current?.artifacts[current.artifacts.length - 1]
  useTileActions(tile.id, 'k-chats', [
    { id: 'new', key: 'n', label: 'New chat', run: () => state.continueInTile(uid()) },
    { id: 'artifact', key: 'a', label: document ? `Open artifact “${document.title}”` : 'Open artifact (select a chat with one)', disabled: !document, run: () => { if (document) state.openArtifact(document.id) } },
    { id: 'delete', key: 'D', keyLabel: 'Delete', label: current ? `Delete chat “${current.title}”…` : 'Delete chat… (select one first)', disabled: !current, run: () => { if (current) void state.remove(current.id) } },
  ])
  return <div className={`project-tile-body k-chats ${wide ? 'wide' : ''}`} ref={root}>
    <div className="project-list">
      <div className="project-tile-toolbar filter-row"><input {...filterField} aria-label="Filter chats and artifacts" placeholder="Filter chats and artifacts…" value={filter} onChange={e => setFilter(e.target.value)} /><kbd aria-hidden>/</kbd></div>
      <button className="project-new" onClick={() => state.continueInTile(uid())}><span className="project-new-plus" aria-hidden>+</span><span>New chat</span><kbd aria-hidden>n</kbd></button>
      <div className="project-sessions">
        {groups.map(g => <section key={g.label} aria-label={g.label} className={g.muted ? 'muted-group' : ''}><span className="k-head">{g.label}</span>
          {g.chats.map(c => { const where = placed(c.id); return <button className={`session-row ${current?.id === c.id ? 'peeked' : ''}`} key={c.id} data-chat-id={c.id} onFocus={() => setSelected(c.id)}
            onClick={e => env.openFrom(tile.id, chatTile(c), listOpen(e))} onKeyDown={e => { if (e.key !== 'Enter') return; e.preventDefault(); env.openFrom(tile.id, chatTile(c), listOpen(e)) }}>
            <Status running={state.pending.includes(c.id)} />
            <span className="session-row-text"><span className="session-row-title truncate">{c.title}</span><span className="session-row-meta truncate">{[when(c.updated), `${turnCount(c)} msg${turnCount(c) === 1 ? '' : 's'}`, artifactsLine(c)].filter(Boolean).join(' · ')}</span></span>
            {where && <span className="placed-badge">{where}</span>}
          </button> })}
        </section>)}
        {state.loaded && !state.chats.length && <div className="empty-list">No chats yet. {state.ready ? 'Ask anything in K, or start one here.' : 'Connect a model to talk to K.'}</div>}
      </div>
      {!wide && <KeyHints hints={[['↵', 'Open chat'], ['a', 'Open artifact']]} />}
    </div>
    {wide && <div className="project-peek" aria-label={current ? `Peek · ${current.title}` : 'Peek'}>{current ? <>
      <header className="peek-head"><h2>{current.title}</h2>
        <div className="peek-meta"><span>{whenLong(current.updated)}</span><span>{turnCount(current)} messages</span><span>{current.tile ? 'Continued in a tile' : 'Started in K'}</span>{(() => { const ctx = [...new Set(current.turns.flatMap(t => t.context || []))]; return ctx.length ? <span>Context: {ctx.slice(0, 3).join(', ')}</span> : null })()}</div></header>
      <span className="k-head peek-label">Last messages</span>
      <div className="peek-messages">{current.turns.filter(t => !t.error).slice(-4).map(t => <div key={t.id} className={`peek-message ${t.role === 'user' ? 'user' : 'assistant'}`}><div className="peek-text">{t.text}</div></div>)}</div>
      {!!current.artifacts.length && <div className="k-peek-artifacts"><span className="k-head">Artifacts</span>{current.artifacts.map(a => <ArtifactCard key={a.id} artifact={a} version={a.versions.length} current={false} open={() => state.openArtifact(a.id)} />)}</div>}
      <KeyHints hints={[['↵', 'Open chat'], ['a', 'Open artifact'], ['↑↓', 'Browse'], ['␣', 'Actions']]} />
    </> : <div className="empty-list">No chat to show.</div>}</div>}
  </div>
}

/**
 * K's chat inside Super+K. The input stays K's: ↵ replies here, Ctrl+↵ continues in a Chat tile,
 * Esc closes and the chat is kept (under Quick when it was one ask).
 */
export function Thread({ state, env, arg, input, setInput, keys, close }: PanelProps<KState>) {
  const [chatID, setChatID] = useState<string>()
  const [choice, setChoice] = useState(0)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    setInput('')
    const id = uid(); setChatID(id)
    void state.ask(id, arg)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const chat = chatID ? state.byID[chatID] : undefined, pending = !!chatID && state.pending.includes(chatID)
  const users = chat?.turns.filter(t => t.role === 'user') || []
  const reply = chat && [...chat.turns].reverse().find(t => t.role === 'k')
  const lastIsReply = chat?.turns[chat.turns.length - 1]?.role === 'k'
  const document = chat?.artifacts[chat.artifacts.length - 1]
  const toTile = () => { if (!chatID) return; state.continueInTile(chatID); if (document) state.openArtifact(document.id); close() }
  const makeDocument = async () => {
    if (!chatID || pending) return
    state.continueInTile(chatID); close()
    await state.ask(chatID, 'Make it a document.')
  }
  const rows = [
    { key: 'tile', icon: 'k', title: 'Continue in a Chat tile', subtitle: 'K · Chat · same thread, opens as a tile', action: 'Move', hint: 'Ctrl+↵', run: toTile },
    document ? { key: 'open', icon: 'doc', title: `Open “${document.title}”`, subtitle: `K · Artifact · v${document.versions.length} · opens beside the chat`, action: 'Open', hint: '', run: toTile }
      : { key: 'doc', icon: 'doc', title: 'Make it a document', subtitle: 'K · Artifact · moves the chat to a tile and opens the document beside it', action: 'Create', hint: '', run: () => void makeDocument() },
  ]
  keys.current = e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toTile(); return true }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setChoice(c => (c + 1) % rows.length); return true }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (input.trim()) { if (!pending && chatID) { void state.ask(chatID, input.trim()); setInput('') } }
      else if (lastIsReply) rows[choice].run()
      return true
    }
    return false
  }
  return <div className="k-thread">
    <div className="k-thread-turns">
      {users.slice(0, -1).map(t => <div key={t.id} className="k-thread-ask">{t.text}</div>)}
      {users.at(-1) && <div className="k-thread-ask latest">{users.at(-1)!.text}<span>turn {users.length}</span></div>}
      {pending ? <div className="k-thinking"><Status running /> K is thinking…</div>
        : reply && (reply.error ? <div className="inline-error">{reply.text}</div> : <div className="k-thread-reply"><Markdown text={reply.text} openURL={url => { env.openURL(url); close() }} />{reply.artifact && <span className="k-thread-made">Made “{document?.title}” · v{reply.artifact.version}</span>}</div>)}
    </div>
    {lastIsReply && !pending && <div className="k-thread-rows">{rows.map((r, i) => <button key={r.key} className={`launcher-result k-row ${i === choice ? 'selected' : ''}`} onClick={r.run} onMouseEnter={() => setChoice(i)}>
      <span className={`k-icon k-icon-${r.icon}`}>{iconText[r.icon]}</span><span className="launcher-result-copy"><strong className="truncate">{r.title}</strong><span className="k-meta"><small className="truncate">{r.subtitle}</small></span></span><span className="k-action">{r.action}</span><kbd className="k-key">{i === choice && !input.trim() ? '↵' : r.hint}</kbd></button>)}</div>}
    <footer className="k-foot"><span>↵ {input.trim() ? 'reply here' : 'run the selected row'}</span><span>Ctrl+↵ continue in tile</span><span>↑↓ choose</span><span>esc close, kept{chat && isQuick(chat) ? ' under Quick' : ' in Chats'}</span></footer>
  </div>
}
