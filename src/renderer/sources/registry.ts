/** Renderer side of every source, in the order K lists them. One line per optional source. */
import type { AnySource } from './types'
import { browserSource, filesSource, terminalSource } from './builtin'
import { connectorsSource } from './connectors'
import { frontSource, githubSource, slackSource } from './services'
import { opencodeSource } from './opencode'

export const registry: AnySource[] = [browserSource, filesSource, terminalSource, connectorsSource, frontSource, slackSource, githubSource, opencodeSource]
export const sourceFor = (kind: string) => registry.find(s => s.kinds.includes(kind))
export const sourceByID = (id: string) => registry.find(s => s.id === id)
