/** Each optional source's namespace on `window.chatos`, and the methods the preload exposes. */
import { opencodeMethods, type OpenCodeAPI } from './sources/opencode/types'
import { kMethods, type KAPI } from './sources/k'

export interface SourceAPIs { opencode: OpenCodeAPI; k: KAPI }
export const sourceMethods: { [K in keyof SourceAPIs]: readonly (keyof SourceAPIs[K])[] } = { opencode: opencodeMethods, k: kMethods }
