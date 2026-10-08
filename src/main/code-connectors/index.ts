import { validateConnector } from '../../shared/connectors'
import { front } from './front'
import { githubConnector } from './github'
import { slackConnector } from './slack'
import type { CodeConnector } from './types'
export type { CodeConnector, CodeContext } from './types'

/** Tests point built-ins at a local fake API: `CHATOS_CONNECTOR_URLS={"front":"http://127.0.0.1:…/front"}`. Loopback only. */
function localOverride(id: string): string | undefined {
  try {
    const url = JSON.parse(process.env.CHATOS_CONNECTOR_URLS || '{}')[id]
    return typeof url === 'string' && /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url) ? url : undefined
  } catch { return undefined }
}
/** Services that ship with ChatOS. Adding one here is all it takes; anything else K builds. */
export const codeConnectors: CodeConnector[] = [front, slackConnector, githubConnector].map(c => ({ ...c, definition: validateConnector({ ...c.definition, baseURL: localOverride(c.definition.id) || c.definition.baseURL }, true) }))
export const codeConnector = (id: string) => codeConnectors.find(c => c.definition.id === id)
