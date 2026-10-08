import { ArrowUp, ChevronDown, Paperclip, Square, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ContextItem } from '../../../shared/types'
import type { AgentInfo, ModelInfo, ModelRef } from '../../../shared/sources/opencode/types'
import { IconButton } from '../../ui'

interface ComposerProps {
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

  return <div className="composer-wrap">
    <div className="composer">
      {props.folderControl}
      {!!props.context.length && <div className="context-chips">{props.context.map(context => <span className="context-chip" key={context.id} title={context.text || context.uri}>
        {context.kind === 'image' && <img src={context.uri} alt="" />}
        <span className="context-kind">{context.kind}</span><span className="truncate">{context.name}</span>
        <IconButton label={`Remove ${context.name}`} onClick={() => props.removeContext(context.id)}><X size={11} /></IconButton>
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
        }}
      />
      <div className="composer-controls">
        <IconButton label="Attach files" onClick={props.attach} disabled={props.disabled}><Paperclip size={16} /></IconButton>
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
        <div className="composer-action">
          {props.running && !props.draft.trim() && !props.context.length
            ? <IconButton label="Interrupt session" className="stop-button" onClick={props.interrupt}><Square size={12} fill="currentColor" /></IconButton>
            : <IconButton label={props.home ? 'Start session' : props.running ? 'Steer session' : 'Send message'} className="send-button" onClick={() => props.send('steer')} disabled={props.disabled || props.sending || (!props.draft.trim() && !props.context.length)}><ArrowUp size={17} /></IconButton>}
        </div>
      </div>
    </div>
    <div className="composer-hint">{props.sending ? 'Sending…' : props.running ? '↵ steer · Alt+↵ queue · Esc interrupt' : props.home ? '↵ start session · Shift+↵ new line' : '↵ send · Shift+↵ new line'}<span>Ctrl+Space launcher</span></div>
  </div>
}
