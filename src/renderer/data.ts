
export const api = window.chatos
/** A known folder, offered by name in K. */
export interface FolderRef { directory: string; name: string }
export const friendlyError = (error: unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error)

