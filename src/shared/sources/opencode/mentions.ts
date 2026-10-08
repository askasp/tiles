/** “@file” and “/skill” mentions in a composer draft. Offsets are in UTF-16 units, as OpenCode's prompt expects. */
export interface Mention { start: number; end: number; text: string }

// Sentence punctuation after a path is not part of it: “look at @src/a.ts, then…”.
const trailing = /[.,;:!?)\]}'"]+$/

/** Every “@path” at the start or after whitespace. */
export function fileMentions(text: string): (Mention & { path: string })[] {
  const found: (Mention & { path: string })[] = []
  for (const match of text.matchAll(/(^|\s)@(\S+)/g)) {
    const path = match[2].replace(trailing, '')
    if (!path) continue
    const start = match.index! + match[1].length
    found.push({ path, start, end: start + 1 + path.length, text: `@${path}` })
  }
  return found
}

/** Every “/name” at the start or after whitespace whose name is one of `names`. */
export function slashMentions(text: string, names: Set<string>): (Mention & { name: string })[] {
  const found: (Mention & { name: string })[] = []
  for (const match of text.matchAll(/(^|\s)\/([\w.:-]+)/g)) {
    const name = match[2].replace(trailing, '')
    if (!names.has(name)) continue
    const start = match.index! + match[1].length
    found.push({ name, start, end: start + 1 + name.length, text: `/${name}` })
  }
  return found
}

/** A message that starts with “/name”: the name and what follows it. */
export function leadingSlash(text: string): { name: string; args: string } | undefined {
  const match = text.match(/^\/([\w.:-]+)(?:\s+([\s\S]*))?$/)
  return match ? { name: match[1], args: (match[2] || '').trim() } : undefined
}

/** The “@…” or “/…” token the caret is in, if any: what the composer autocompletes. */
export function activeMention(text: string, caret: number): { kind: '@' | '/'; query: string; start: number; end: number } | undefined {
  const before = text.slice(0, caret)
  const match = before.match(/(^|\s)([@/])(\S*)$/)
  if (!match) return
  const start = caret - match[3].length - 1
  // A “/” only completes as the first word, or after a space when it isn't a path like “/usr/bin”.
  if (match[2] === '/' && match[3].includes('/')) return
  const rest = text.slice(caret).match(/^\S*/)![0]
  return { kind: match[2] as '@' | '/', query: match[3], start, end: caret + rest.length }
}
