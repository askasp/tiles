import { convert } from 'html-to-text'
import type { FrontConversation, FrontMessage } from '../shared/types'

export const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export const objects = (v: unknown) => Array.isArray(v) ? v.slice(0, 50).map(object) : []
const text = (v: unknown, max = 300) => typeof v === 'string' ? v.slice(0, max) : ''
const timestamp = (v: unknown) => {
  if (typeof v !== 'number') return
  const milliseconds = v * 1000
  return Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8.64e15 ? milliseconds : undefined
}
export function frontSummary(data: Record<string, unknown>): FrontConversation {
  const last = object(data.last_message), assignee = object(data.assignee)
  return { id: text(data.id), subject: text(data.subject) || 'Untitled conversation', status: text(data.status),
    sender: text(object(data.recipient).handle), preview: text(last.blurb, 500), updatedAt: timestamp(last.created_at),
    assignee: text(assignee.username) || text(assignee.email) || undefined,
    tags: objects(data.tags).map(t => text(t.name)).filter(Boolean),
  }
}
export function frontMessage(data: Record<string, unknown>): FrontMessage {
  // Email HTML never reaches the renderer. Conversion is pure text processing:
  // no scripts, iframes, remote images, tracking pixels, or attachment fetching.
  const body = text(data.text, 100_000) || convert(text(data.body, 1_000_000), { wordwrap: false,
    selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }, { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }, { selector: 'iframe', format: 'skip' }],
  }).slice(0, 100_000)
  return { id: text(data.id), subject: text(data.subject), text: body, inbound: data.is_inbound === true, draft: !!data.draft_mode,
    createdAt: timestamp(data.created_at),
    recipients: objects(data.recipients).map(r => ({ role: text(r.role), name: text(r.name), handle: text(r.handle) })),
    attachments: objects(data.attachments).map(a => ({ name: text(a.filename), size: typeof a.size === 'number' && Number.isFinite(a.size) ? a.size : undefined })),
  }
}
export function frontCursor(data: Record<string, unknown>, path: string): string | undefined {
  const next = object(data._pagination).next
  if (typeof next !== 'string') return
  try {
    const url = new URL(next)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname === 'api2.frontapp.com' || /^[a-z0-9-]+\.api\.frontapp\.com$/.test(url.hostname)) || decodeURIComponent(url.pathname) !== decodeURIComponent(new URL(path, 'https://api2.frontapp.com/').pathname)) return
    const cursor = url.searchParams.get('page_token')
    return cursor && cursor.length <= 4096 ? cursor : undefined
  } catch { return }
}
