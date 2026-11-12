import { artifactTile, chatTile, chatsTile } from '../../../shared/sources/k'
import { uid } from '../../../shared/util'
import { registerBadge } from '../../Setup'
import { source, type Candidate } from '../types'
import { useK, type KState } from './state'
import { ArtifactBody, ChatBody, ChatsBody, Thread } from './tiles'

registerBadge('k', 'K')
registerBadge('doc', 'doc')

/** A question or a request, rather than a title to find: K offers to answer it first. */
const looksLikeAsk = (raw: string) => {
  const text = raw.trim()
  return /\?$/.test(text) || text.split(/\s+/).length >= 4 || /^(what|why|how|when|where|who|which|can|could|should|is|are|do|does|explain|draft|write|summari[sz]e|translate|make|plan|list|compare|help)\b/i.test(text)
}

/** K: one assistant. Chats start in Super+K, continue in a Chat tile; what they make opens as a tile. */
export const kSource = source<KState>({
  id: 'k', badge: 'k', kinds: ['chats', 'chat', 'artifact'],
  use: useK,
  added: state => state.ready || state.chats.length > 0,
  isList: tile => tile.kind === 'chats',
  candidates(q, state) {
    const result: Candidate[] = [{ input: chatsTile(), score: Math.max(q.rank('Chats'), q.rank('K chats artifacts')) }]
    for (const chat of state.chats) {
      result.push({ input: chatTile(chat), score: q.raw.trim() ? q.rank(chat.title) : 0 })
      for (const a of chat.artifacts) result.push({ input: artifactTile(a, chat.id), score: q.raw.trim() ? q.rank(`${a.title} ${chat.title}`) : 0 })
    }
    return result
  },
  commands(q, state) {
    const text = q.raw.trim()
    if (!text || !state.ready || (q.scope && q.scope !== 'k') || text.length > 4000) return []
    return [{ key: 'ask-k', icon: 'k', title: text, source: 'Ask K', subtitle: 'a chat · ↵ answers here, Ctrl+↵ continues in a tile', action: 'Ask', first: looksLikeAsk(text), panel: { source: 'k', arg: text }, run: () => {} }]
  },
  Panel: props => <Thread {...props} />,
  Tile({ tile, state, env, focused, focusKey }) {
    if (tile.kind === 'chat') return <ChatBody tile={tile} state={state} env={env} focused={focused} focusKey={focusKey} />
    if (tile.kind === 'artifact') return <ArtifactBody tile={tile} state={state} env={env} />
    return <ChatsBody tile={tile} state={state} env={env} />
  },
  tileStatus: (tile, state) => tile.kind === 'chat' && tile.ref ? { running: state.pending.includes(tile.ref) } : undefined,
  onShortcut(action, state) {
    if (action !== 'new') return false
    state.continueInTile(uid())
    return true
  },
  contextTargets: state => state.chats.map(c => ({ id: c.id, title: c.title, subtitle: 'K chat', input: chatTile(c) })),
  acceptsContext: ['chat'],
})
