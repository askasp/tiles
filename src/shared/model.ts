import { connectorBaseURL, validateConnector, type ConnectorDefinition } from './connectors'

/** K's model: any OpenAI-compatible endpoint, or a model your OpenCode service is signed into
 * (including a ChatGPT subscription), addressed as `providerID/modelID`. */
export interface ModelSettings { provider?: 'opencode'; baseURL: string; model: string }
export interface ModelInfo extends ModelSettings { configured: boolean; ready: boolean; skipped: boolean; local: boolean; tokenStorage: 'encrypted' | 'session' | 'none' }
/** How K reaches models through OpenCode. Main process only. */
export interface OpenCodeModels { connected(): boolean; generate(prompt: string, model: { providerID: string; id: string }): Promise<string> }
/** Result of checking a model endpoint before it is saved. Never contains the key. */
export interface ModelProbe { baseURL: string; models: string[]; account?: string }
export const localModelURL = 'http://localhost:11434/v1'
export const isLoopbackURL = (url: string) => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) } catch { return false } }
export type DiscoveryPlan =
  | { kind: 'answer'; text: string }
  | { kind: 'opencode'; text: string; url?: string }
  | { kind: 'connector'; text: string; definition: ConnectorDefinition }

/** A plan plus the public documentation pages that were read to make it. */
export type DiscoveryResult = DiscoveryPlan & { read: string[] }
export interface DiscoveryTurn { role: 'user' | 'k'; text: string }

export const opencodeModelRef = (model: string) => { const i = model.indexOf('/'); return { providerID: model.slice(0, i), id: model.slice(i + 1) } }
export function modelSettings(raw: ModelSettings): ModelSettings {
  if (raw?.provider === 'opencode') {
    const model = typeof raw.model === 'string' ? raw.model.trim() : ''
    if (!/^[\w.@-]+\/[^\s/][^\s]{0,199}$/.test(model)) throw new Error('Choose one of your OpenCode models')
    return { provider: 'opencode', baseURL: '', model }
  }
  if (!raw || typeof raw.baseURL !== 'string' || typeof raw.model !== 'string') throw new Error('Enter an API base URL and model ID')
  const baseURL = connectorBaseURL(raw.baseURL)
  if (new URL(baseURL).search || new URL(baseURL).hash) throw new Error('Model API base URL cannot have query parameters or a fragment')
  const model = raw.model.trim()
  if (!model || model.length > 200 || /[\r\n\x00]/.test(model)) throw new Error('Enter a valid model ID')
  return { baseURL, model }
}
export function discoveryPlan(raw: unknown): DiscoveryPlan {
  if (!raw || typeof raw !== 'object') throw new Error('AI returned an invalid discovery proposal')
  const p = raw as Record<string, unknown>
  if (typeof p.text !== 'string' || p.text.length > 6000) throw new Error('AI returned an invalid explanation')
  if (p.kind === 'answer') return { kind: 'answer', text: p.text }
  if (p.kind === 'connector') return { kind: 'connector', text: p.text, definition: validateConnector(p.definition) }
  if (p.kind === 'opencode') {
    const url = p.url === undefined ? undefined : connectorBaseURL(String(p.url))
    return { kind: 'opencode', text: p.text, ...(url && { url }) }
  }
  throw new Error('AI proposal has an unsupported action; no action was run')
}
