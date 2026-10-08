/** Main-process side of optional sources. One line per source. */
import type { SourceAPIs } from '../shared/registry-api'
import type { SecretStorage } from './secrets'
import type { Storage } from './storage'
import { createOpenCodeSource } from './sources/opencode'

export interface MainContext {
  /** Sends a live event to this source's renderer adapter. */
  emit(event: unknown): void
  storage: Storage
  secrets: SecretStorage
  env: NodeJS.ProcessEnv
  home: string
  platform: string
  /** A native confirmation. `action` names the button, e.g. “Delete”. */
  confirm(title: string, detail: string, action?: string): Promise<boolean>
}
export interface MainSource<K extends keyof SourceAPIs = keyof SourceAPIs> { id: K; api: SourceAPIs[K]; dispose(): void }
export const mainSources: { [K in keyof SourceAPIs]: (ctx: MainContext) => MainSource<K> } = { opencode: createOpenCodeSource }
