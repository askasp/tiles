import { frontFilters, frontIdentity } from '../../shared/front'
import { frontCursor, frontMessage, frontSummary } from '../front-data'
import { record, records, text, type CodeConnector } from './types'

const conversationID = /^cnv_[a-z0-9]+$/i
const iso = (milliseconds?: number) => milliseconds === undefined ? undefined : new Date(milliseconds).toISOString()
const check = (key: 'email' | 'teammateID' | 'tagID') => (value: string) => { try { frontIdentity({ email: '', teammateID: '', tagID: '', [key]: value }); return undefined } catch (e) { return (e as Error).message } }

/** Front: mail and comments. Code for search paths, HTML mail and comments-as-notes. */
export const front: CodeConnector = {
  hint: 'Inboxes and conversations',
  definition: {
    version: 1, id: 'front', name: 'Front', baseURL: 'https://api2.frontapp.com',
    auth: { type: 'bearer', help: 'Front → Settings → Developers → API tokens. Reading needs conversations:read and messages:read; Reply needs messages:send and Comment needs comments:write.' },
    operations: [
      { id: 'conversations', label: 'List conversations', method: 'GET', effect: 'read', path: '/conversations', query: { limit: '25', page_token: '{cursor}' }, pagination: 'cursor' },
      { id: 'conversation', label: 'Read conversation', method: 'GET', effect: 'read', path: '/conversations/{id}' },
      { id: 'reply', label: 'Reply', method: 'POST', effect: 'write', path: '/conversations/{id}/messages', body: { body: '{draft}' } },
      { id: 'comment', label: 'Comment', method: 'POST', effect: 'write', path: '/conversations/{id}/comments', body: { body: '{draft}' } },
    ],
    recipes: [
      { id: 'inbox', label: 'Inbox', shape: 'collection', view: 'list', operation: 'conversations', searchOperation: 'conversations', itemRecipe: 'conversation', items: '_results', idField: 'id', titleField: 'subject', subtitleField: 'recipient.handle', fields: [{ label: 'Status', path: 'status', kind: 'badge' }] },
      { id: 'conversation', label: 'Conversation', shape: 'item', view: 'conversation', operation: 'conversation', idField: 'id', titleField: 'subject', fields: [{ label: 'Status', path: 'status', kind: 'badge' }], actions: [{ label: 'Reply', operation: 'reply' }, { label: 'Comment', operation: 'comment' }] },
    ],
  },
  settings: [
    { key: 'email', label: 'Your email', placeholder: 'you@example.com', check: check('email') },
    { key: 'teammateID', label: 'Your teammate ID', placeholder: 'tea_…', check: check('teammateID') },
    { key: 'tagID', label: 'A tag to follow', placeholder: 'tag_…', check: check('tagID') },
  ],
  filters: settings => frontFilters({ email: settings.email || '', teammateID: settings.teammateID || '', tagID: settings.tagID || '' }).map(f => ({ title: f.title, recipeID: 'inbox', query: f.query, ready: f.ready })),
  async validate(context) {
    const me = await context.get('/me')
    return text(me.email) || text(me.username) || text(me.name) || 'Front API token'
  },
  // Replies and comments are written as you, when Front knows which teammate you are.
  body: (_operation, body, settings) => settings.teammateID ? { ...body, author_id: settings.teammateID } : body,
  async read(recipe, ref, cursor, context) {
    if (recipe.id === 'inbox') {
      const query = ref.query?.trim() || '', path = query ? `/conversations/search/${encodeURIComponent(query)}` : '/conversations'
      const data = await context.get(path, { limit: '25', ...(cursor && { page_token: cursor }) })
      const items = records(data._results, 25).filter(c => conversationID.test(text(c.id))).map(c => {
        const s = frontSummary(c)
        return { id: s.id, title: s.subject, subtitle: [s.sender, s.assignee && `→ ${s.assignee}`, s.preview].filter(Boolean).join(' · '), text: '', time: iso(s.updatedAt),
          fields: [{ label: 'Status', value: s.status, kind: 'badge' as const }, ...(s.tags.length ? [{ label: 'Tags', value: s.tags.join(', ') }] : [])] }
      })
      return { items, messages: [], next: frontCursor(data, path) }
    }
    const id = ref.resourceID || ''
    if (!conversationID.test(id)) throw new Error('Invalid Front conversation ID')
    const [conversation, messages, comments] = await Promise.all([
      context.get(`/conversations/${id}`),
      context.get(`/conversations/${id}/messages`, { limit: '25', sort_by: 'created_at', sort_order: 'desc' }),
      context.get(`/conversations/${id}/comments`).catch(() => ({ _results: [] })),
    ])
    if (conversation.id !== id) throw new Error('Front returned a different conversation; it may have been merged. Open it in Front to check.')
    const s = frontSummary(conversation)
    const mail = records(messages._results, 25).filter(m => /^msg_[a-z0-9]+$/i.test(text(m.id))).map(m => {
      const message = frontMessage(m), from = message.recipients.find(r => r.role === 'from')
      const attachments = message.attachments.map(a => `📎 ${a.name}`).join('\n')
      return { at: message.createdAt || 0, kind: 'message' as const, text: [message.text, attachments].filter(Boolean).join('\n\n'), author: from?.name || from?.handle || (message.inbound ? 'Customer' : 'Team'), time: iso(message.createdAt) || '' }
    })
    const notes = records(comments._results, 50).map(c => {
      const at = typeof c.posted_at === 'number' ? c.posted_at * 1000 : 0, author = record(c.author)
      return { at, kind: 'note' as const, text: text(c.body, 50_000), author: text(author.username) || text(author.email) || 'Teammate', time: iso(at) || '' }
    })
    return {
      items: [{ id, title: s.subject, subtitle: s.sender, text: '', fields: [{ label: 'Status', value: s.status, kind: 'badge' as const }, ...(s.assignee ? [{ label: 'Assignee', value: s.assignee }] : []), ...(s.tags.length ? [{ label: 'Tags', value: s.tags.join(', ') }] : [])] }],
      messages: [...mail, ...notes].sort((a, b) => a.at - b.at).map(({ at: _at, ...m }) => m),
    }
  },
}
