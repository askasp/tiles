/** What a source is: its name, the tile kinds it owns and how each reads in K. */
export interface CatalogueEntry {
  id: string
  name: string
  hint: string
  /** Typed before a query to narrow K to this source, e.g. `files chatos`. */
  prefixes: string[]
  /** Web pages on these hosts belong to this source. */
  hosts: string[]
  /** Browser, Files and Terminal ship with ChatOS; every other source is added by asking K. */
  builtin: boolean
  kinds: Record<string, { label: string; kind: string; action: string }>
  /** Ships as a built-in connector: `add front` shows it straight away, no model needed. */
  connector?: boolean
}
export const coreCatalogue: CatalogueEntry[] = [
  { id: 'web', name: 'Browser', hint: 'One tile per URL', prefixes: ['web', 'browser'], hosts: [], builtin: true, kinds: { browser: { label: 'Web page', kind: 'Web page', action: 'Open browser' } } },
  { id: 'files', name: 'Files', hint: 'Folders, text and images', prefixes: ['files'], hosts: [], builtin: true, kinds: { folder: { label: 'Folder', kind: 'Folder', action: 'Browse files' }, file: { label: 'File', kind: 'File', action: 'Open' } } },
  { id: 'terminal', name: 'Terminal', hint: 'A shell in any folder', prefixes: ['terminal'], hosts: [], builtin: true, kinds: { terminal: { label: 'Terminal', kind: 'Shell', action: 'Open terminal' } } },
  { id: 'front', name: 'Front', hint: 'Inboxes and conversations', prefixes: ['mail', 'front'], hosts: ['frontapp.com', 'front.com'], builtin: false, connector: true, kinds: {} },
  { id: 'slack', name: 'Slack', hint: 'DMs and mentions', prefixes: ['slack', 'dm'], hosts: ['slack.com'], builtin: false, connector: true, kinds: {} },
  { id: 'github', name: 'GitHub', hint: 'Pull requests to review', prefixes: ['github', 'pr'], hosts: ['github.com'], builtin: false, connector: true, kinds: {} },
]
