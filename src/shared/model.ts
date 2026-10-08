import { connectorBaseURL, validateConnector, type ConnectorDefinition } from './connectors'

export interface ModelSettings { baseURL: string; model: string }
export interface ModelInfo extends ModelSettings { configured: boolean; ready: boolean; skipped: boolean; local: boolean; tokenStorage: 'encrypted' | 'session' | 'none' }
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

export function modelSettings(raw: ModelSettings): ModelSettings {
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
