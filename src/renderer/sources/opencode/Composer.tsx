import { ChevronDown } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ContextItem } from '../../../shared/types'
import type { AgentInfo, ModelInfo, ModelRef } from '../../../shared/sources/opencode/types'
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

export function Composer(props: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null)
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
      {!!props.context.length && <div className="context-chips">{props.context.map(context => <span className="context-chip" key={context.id} title={context.text || context.uri}>
        {context.kind === 'image' && <img src={context.uri} alt="" />}
        <span className="context-kind">{context.kind}</span><span className="truncate">{context.name}</span>
      </span>)}</div>}
      <textarea
        ref={input} className="composer-input" aria-label={props.home ? 'New session prompt' : 'Message'}
        placeholder={props.home ? 'What should we work on?' : props.running ? 'Steer the agent, or queue a follow-up…' : 'Add a follow-up…'}
        value={props.draft} onChange={event => props.setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
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
    <div className="composer-hint">{props.sending ? 'Sending…' : props.running ? '↵ steer · Alt+↵ queue · Esc interrupt' : props.home ? '↵ start session · Shift+↵ new line' : '↵ send · Shift+↵ new line'}<span>{props.running ? '' : 'Esc leaves · '}{systemKey}+. actions</span></div>
  </div>
}
