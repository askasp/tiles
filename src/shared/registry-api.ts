/** Each optional source's namespace on `window.chatos`, and the methods the preload exposes. */
import { opencodeMethods, type OpenCodeAPI } from './sources/opencode/types'

export interface SourceAPIs { opencode: OpenCodeAPI }
export const sourceMethods: { [K in keyof SourceAPIs]: readonly (keyof SourceAPIs[K])[] } = { opencode: opencodeMethods }
