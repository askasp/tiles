import type { MainContext, MainSource } from '../registry'
import { validChat, type Chat } from '../../shared/sources/k'

/** K's chats, one row each in local storage. Replies go to the model the person connected. */
export function createKSource(ctx: MainContext): MainSource<'k'> {
  const key = (id: string) => `k-chat:${id}`
  return {
    id: 'k',
    api: {
      chats: async () => ctx.storage.entries('k-chat:').flatMap(raw => { try { return [validChat(JSON.parse(raw))] } catch { return [] } }).sort((a: Chat, b: Chat) => b.updated - a.updated),
      save: async raw => { const chat = validChat(raw); ctx.storage.set(key(chat.id), JSON.stringify(chat)) },
      remove: async id => {
        const raw = typeof id === 'string' && ctx.storage.get(key(id))
        if (!raw) return true
        let chat: Chat | undefined
        try { chat = validChat(JSON.parse(raw)) } catch { /* Unreadable: delete without the details. */ }
        const made = chat?.artifacts.length ? ` and its ${chat.artifacts.length === 1 ? 'document' : `${chat.artifacts.length} documents`}` : ''
        if (!await ctx.confirm(`Delete “${chat?.title || 'this chat'}”?`, `The chat${made} are deleted from this computer. There is no undo.`, 'Delete')) return false
        ctx.storage.delete(key(id)); return true
      },
      reply: messages => ctx.ask(messages),
    },
    dispose() {},
  }
}
