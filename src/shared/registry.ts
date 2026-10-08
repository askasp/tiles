/** The one place that lists optional sources. Removing a source here (and in
 * the main and renderer registries) removes it from ChatOS entirely. */
import type { KindRule, TileDesktop } from './tiles'
import { coreKinds, restoreDesktop } from './tiles'
import { coreCatalogue, type CatalogueEntry } from './catalogue'
import { migrateV1, opencodeEntry, opencodeKinds } from './sources/opencode'
export type { SourceAPIs } from './registry-api'

export const catalogue: CatalogueEntry[] = [...coreCatalogue, opencodeEntry]
export const kindRules: KindRule[] = [...coreKinds, ...opencodeKinds]
const migrations: ((raw: string, directory: string) => TileDesktop | undefined)[] = [migrateV1]

/** Restore any saved desktop: older formats first, then the current one with every registered kind. */
export function restore(raw: string | null, directory = ''): TileDesktop {
  if (raw) for (const migrate of migrations) { const migrated = migrate(raw, directory); if (migrated) return restoreDesktop(JSON.stringify(migrated), directory, kindRules) }
  return restoreDesktop(raw, directory, kindRules)
}
