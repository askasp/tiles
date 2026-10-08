import { ChevronDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ContextItem } from '../../../shared/types'
import type { AgentInfo, ModelInfo, ModelRef, SlashCommand, SlashSkill } from '../../../shared/sources/opencode/types'
import { activeMention } from '../../../shared/sources/opencode/mentions'
import { systemKey } from '../../ui'
import { useTileActions } from '../../actions'

interface ComposerProps {
  /** Without one (no tile), the composer registers no actions. */
  tileID?: string
  draft: string
  setDraft: (text: string) => void
  context: ContextItem[]
  removeContext: (id: string) => void
  attach: () => void
  agents: AgentInfo[]
  models: ModelInfo[]
  /** “/” completes these; “@” completes files and folders through findFiles. */
  commands?: SlashCommand[]
  skills?: SlashSkill[]
  findFiles?: (query: string) => Promise<{ path: string; type: 'file' | 'directory' }[]>
  agent?: string
  model?: ModelRef
  setAgent: (id: string) => void
  setModel: (model?: ModelRef) => void
  send: (delivery: 'steer' | 'queue') => void
  interrupt?: () => void
  running?: boolean
  sending?: boolean
  disabled?: boolean
  home?: boolean
  folderControl?: React.ReactNode
  focusKey?: number
}

interface Suggestion { key: string; insert: string; label: string; detail?: string; kind: 'file' | 'folder' | 'command' | 'skill' }

const rank = (query: string, ...names: string[]) => {
  const q = query.toLowerCase()
  const scores = names.map(name => { const n = name.toLowerCase(); return n.startsWith(q) ? 0 : n.includes(q) ? 1 : 2 })
  return Math.min(...scores)
}

/** What “@” and “/” offer at the caret: files and folders, or commands and skills. */
function useMentions(props: ComposerProps, caret: number, active: boolean) {
  const trigger = active ? activeMention(props.draft, caret) : undefined
  const [files, setFiles] = useState<{ query: string; list: Suggestion[] }>({ query: '', list: [] })
  const fileQuery = trigger?.kind === '@' ? trigger.query : undefined
  // The search function changes every render; only a new query should search again.
  const findFiles = useRef(props.findFiles); findFiles.current = props.findFiles
  const searchable = !!props.findFiles
  useEffect(() => {
    if (fileQuery === undefined || !findFiles.current) return
    let valid = true
    const timer = setTimeout(() => {
      void findFiles.current?.(fileQuery).then(list => {
        if (valid) setFiles({ query: fileQuery, list: list.map(entry => {
          const path = entry.type === 'directory' ? `${entry.path.replace(/\/$/, '')}/` : entry.path
          return { key: `${entry.type}:${path}`, insert: `@${path}`, label: path, kind: entry.type === 'directory' ? 'folder' : 'file' }
        }) })
      }).catch(() => { if (valid) setFiles({ query: fileQuery, list: [] }) })
    }, 90)
    return () => { valid = false; clearTimeout(timer) }
  }, [fileQuery, searchable])
  const slash = useMemo(() => {
    if (trigger?.kind !== '/') return []
    const query = trigger.query
    // Commands run only as the first word; skills attach from anywhere.
    const commands: Suggestion[] = trigger.start === 0 ? (props.commands || []).map(command => ({ key: `command:${command.name}`, insert: `/${command.name}`, label: `/${command.name}`, detail: command.description, kind: 'command' })) : []
    const skills: Suggestion[] = (props.skills || []).map(skill => ({ key: `skill:${skill.id}`, insert: `/${skill.id}`, label: `/${skill.id}`, detail: skill.description || skill.name, kind: 'skill' }))
    return [...commands, ...skills]
      .map(item => ({ item, score: rank(query, item.label.slice(1), item.detail || '') }))
      .filter(({ score }) => score < 2 || !query)
      .sort((a, b) => a.score - b.score)
      .slice(0, 8).map(({ item }) => item)
  }, [trigger?.kind, trigger?.query, trigger?.start, props.commands, props.skills]) // eslint-disable-line react-hooks/exhaustive-deps
  // While a new search runs, the last results that still match stay up, so the list doesn't flicker shut.
  const items = trigger?.kind === '@'
    ? (files.query === trigger.query ? files.list : files.list.filter(item => item.label.toLowerCase().includes(trigger.query.toLowerCase()))).slice(0, 8)
    : slash
  const fresh = trigger?.kind !== '@' || files.query === trigger.query
  return { trigger, items, fresh }
}

export function Composer(props: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [caret, setCaret] = useState(0)
  const [typing, setTyping] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState<string>()
  const { trigger, items, fresh } = useMentions(props, caret, typing)
  const triggerKey = trigger && `${trigger.kind}${trigger.start}`
  const menu = trigger && items.length && dismissed !== triggerKey ? items : undefined
  useEffect(() => { setHighlight(0) }, [triggerKey, trigger?.query])
  const accept = (item: Suggestion) => {
    if (!trigger) return
    // A folder keeps completing inside it; anything else ends the mention with a space.
    const insert = item.kind === 'folder' ? item.insert : `${item.insert} `
    const next = props.draft.slice(0, trigger.start) + insert + props.draft.slice(trigger.end).replace(/^ /, '')
    const position = trigger.start + insert.length
    placed.current = { draft: next, position }
    props.setDraft(next); setCaret(position)
  }
  // The caret goes after the insertion in the same render the new draft lands, before more keys arrive.
  const placed = useRef<{ draft: string; position: number } | undefined>(undefined)
  useLayoutEffect(() => {
    if (placed.current?.draft !== props.draft) return
    input.current?.setSelectionRange(placed.current.position, placed.current.position)
    placed.current = undefined
  }, [props.draft])
  const syncCaret = (event: React.SyntheticEvent<HTMLTextAreaElement>) => setCaret(event.currentTarget.selectionStart)
  const model = props.models.find(model => model.id === props.model?.id && model.providerID === props.model?.providerID)
  useEffect(() => {
    if (!input.current) return
    input.current.style.height = '0'
    input.current.style.height = `${Math.min(168, Math.max(56, input.current.scrollHeight))}px`
  }, [props.draft, props.focusKey])
  useEffect(() => { if (props.focusKey) input.current?.focus() }, [props.focusKey])
  const root = useRef<HTMLDivElement>(null)
  const pick = (label: string) => { const select = root.current?.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`); if (!select) return; select.focus(); try { select.showPicker() } catch { /* focused is enough */ } }
  const empty = !props.draft.trim() && !props.context.length
  useTileActions(props.tileID || '', 'opencode-composer', props.tileID ? [
    { id: 'write', label: 'Write a message', key: 'i', run: () => input.current?.focus() },
    { id: 'send', label: props.home ? 'Start the session' : props.running ? 'Steer with the message' : 'Send the message', keyLabel: '↵', disabled: props.disabled || props.sending || empty, run: () => props.send('steer') },
    ...(props.running ? [
      { id: 'queue', label: 'Queue the message for after this turn', keyLabel: 'Alt+↵', disabled: props.disabled || empty, run: () => props.send('queue') },
      { id: 'interrupt', label: 'Interrupt the agent', key: 'c', keyLabel: 'Esc', run: () => props.interrupt?.() },
    ] : []),
    { id: 'attach', label: 'Attach files', key: 'f', disabled: props.disabled, run: props.attach },
    { id: 'agent', label: 'Choose the agent', key: 'g', disabled: props.disabled, run: () => pick('Agent') },
    { id: 'model', label: 'Choose the model', key: 'm', disabled: props.disabled, run: () => pick('Model') },
    ...(model?.variants.length ? [{ id: 'variant', label: 'Choose the model variant', key: 'v', disabled: props.disabled, run: () => pick('Model variant') }] : []),
    ...props.context.map(context => ({ id: `remove-${context.id}`, label: `Remove context · ${context.name}`, run: () => props.removeContext(context.id) })),
  ] : [])

  return <div className="composer-wrap" ref={root}>
    <div className="composer">
      {props.folderControl}
      {menu && <div className="mention-menu" role="listbox" id={`${props.tileID || 'composer'}-mentions`} aria-label={trigger!.kind === '@' ? 'Files and folders' : 'Commands and skills'}>
        {menu.map((item, index) => <div key={item.key} id={`${props.tileID || 'composer'}-mention-${index}`} role="option" aria-selected={index === highlight}
          className={`mention-option${index === highlight ? ' selected' : ''}`} onMouseDown={event => { event.preventDefault(); accept(item) }} onMouseEnter={() => setHighlight(index)}>
          <span className="mention-kind">{item.kind}</span><span className="mention-label truncate">{item.label}</span>{item.detail && <span className="mention-detail truncate">{item.detail}</span>}
        </div>)}
      </div>}
      {!!props.context.length && <div className="context-chips">{props.context.map(context => <span className="context-chip" key={context.id} title={context.text || context.uri}>
        {context.kind === 'image' && <img src={context.uri} alt="" />}
        <span className="context-kind">{context.kind}</span><span className="truncate">{context.name}</span>
      </span>)}</div>}
      <textarea
        ref={input} className="composer-input" aria-label={props.home ? 'New session prompt' : 'Message'}
        placeholder={props.home ? 'What should we work on?' : props.running ? 'Steer the agent, or queue a follow-up…' : 'Add a follow-up…'}
        value={props.draft} onChange={event => { props.setDraft(event.target.value); syncCaret(event) }}
        onSelect={syncCaret} onFocus={event => { setTyping(true); syncCaret(event) }} onBlur={() => setTyping(false)}
        aria-autocomplete="list" aria-controls={menu ? `${props.tileID || 'composer'}-mentions` : undefined}
        aria-activedescendant={menu ? `${props.tileID || 'composer'}-mention-${highlight}` : undefined}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          // The suggestion list only takes keys while it is open, and only inside the message box.
          if (menu) {
            const step = event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n') ? 1 : event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p') ? -1 : 0
            if (step) { event.preventDefault(); event.stopPropagation(); setHighlight(index => (index + step + menu.length) % menu.length); return }
            if ((event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) || (event.key === 'Tab' && !event.shiftKey)) {
              // Never insert a result from the previous search; the new one is a moment away.
              event.preventDefault(); event.stopPropagation(); if (fresh) accept(menu[Math.min(highlight, menu.length - 1)]); return
            }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissed(triggerKey); return }
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault()
            if (!props.disabled && !props.sending && (props.draft.trim() || props.context.length)) props.send(event.altKey ? 'queue' : 'steer')
          }
          if (event.key === 'Escape' && props.running) { event.preventDefault(); props.interrupt?.() }
          // Esc leaves the message box for the tile, where letters are actions again (like vim's normal mode).
          else if (event.key === 'Escape' && props.tileID) { event.preventDefault(); event.currentTarget.closest<HTMLElement>('[data-tile-id]')?.focus() }
        }}
      />
      <div className="composer-controls">
        <label className="select-control" title="Agent">
          <select aria-label="Agent" value={props.agent || ''} onChange={event => props.setAgent(event.target.value)} disabled={props.disabled}>
            <option value="">Default agent</option>
            {props.agents.map(agent => <option value={agent.id} key={agent.id}>{agent.name}</option>)}
          </select><ChevronDown size={11} />
        </label>
        <label className="select-control model-select" title={model ? `${model.providerID} / ${model.id}` : 'Use the server’s default model'}>
          <select aria-label="Model" value={props.model ? JSON.stringify({ id: props.model.id, providerID: props.model.providerID }) : ''} onChange={event => props.setModel(event.target.value ? JSON.parse(event.target.value) : undefined)} disabled={props.disabled}>
            <option value="">Default model</option>
            {[...new Set(props.models.map(model => model.providerID))].map(provider => <optgroup label={provider} key={provider}>
              {props.models.filter(model => model.providerID === provider).map(model => <option key={model.id} value={JSON.stringify({ id: model.id, providerID: provider })}>{model.name}</option>)}
            </optgroup>)}
          </select><ChevronDown size={11} />
        </label>
        {!!model?.variants.length && <label className="select-control variant-select" title="Model variant">
          <select aria-label="Model variant" value={props.model?.variant || ''} onChange={event => props.setModel({ ...props.model!, variant: event.target.value || undefined })} disabled={props.disabled}>
            <option value="">default</option>{model.variants.map(variant => <option key={variant.id} value={variant.id}>{variant.id}</option>)}
          </select><ChevronDown size={10} />
        </label>}
      </div>
    </div>
    <div className="composer-hint">{menu ? '↑↓ choose · ↵ or Tab insert · Esc close' : props.sending ? 'Sending…' : props.running ? '↵ steer · Alt+↵ queue · Esc interrupt' : props.home ? '↵ start session · Shift+↵ new line' : `↵ send · Shift+↵ new line${props.findFiles ? ' · @ file · / skill' : ''}`}<span>{props.running ? '' : 'Esc leaves · '}{systemKey}+. actions</span></div>
  </div>
}
