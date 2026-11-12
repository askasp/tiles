import { useCallback, useEffect, useRef, useState } from 'react'
import { applyReply, artifactOf, artifactTile, chatTile, chatTitle, kMessages, type Artifact, type Chat } from '../../../shared/sources/k'
import { hideTile, isLive, type OpenMode } from '../../../shared/tiles'
import type { ContextItem } from '../../../shared/types'
import { uid } from '../../../shared/util'
import { api, friendlyError } from '../../data'
import type { Env } from '../types'

const k = api.k

export interface KState {
  /** A model is connected: K can answer. */
  ready: boolean
  loaded: boolean
  /** Newest first. */
  chats: Chat[]
  byID: Record<string, Chat>
  /** Chats waiting on K's reply. */
  pending: string[]
  /** Asks K in a chat (a new one when `chatID` is unknown). Never throws: a failure is a turn that says so. */
  ask(chatID: string | undefined, text: string, context?: ContextItem[]): Promise<{ chat: Chat; artifact?: Artifact }>
  /** The chat as a tile: the same thread, with its history. */
  continueInTile(chatID: string, mode?: OpenMode): void
  /** An artifact's tile, beside its chat when the chat is a tile. */
  openArtifact(artifactID: string, mode?: OpenMode): void
  /** Asks first; closes the chat's tiles. False when cancelled. */
  remove(chatID: string): Promise<boolean>
  /** The chat is shown as a tile: it no longer counts as a Quick ask. */
  markTiled(chatID: string): void
}

const blank = (id: string, text: string, now: number): Chat => ({ id, title: chatTitle(text), created: now, updated: now, tile: false, turns: [], artifacts: [] })

export function useK(env: Env): KState {
  const envRef = useRef(env); envRef.current = env
  const chats = useRef<Record<string, Chat>>({})
  const [byID, setByID] = useState<Record<string, Chat>>({})
  const [loaded, setLoaded] = useState(false)
  const [pending, setPending] = useState<string[]>([])
  useEffect(() => {
    void k.chats().then(list => { chats.current = { ...Object.fromEntries(list.map(c => [c.id, c])), ...chats.current }; setByID(chats.current) }).catch(e => envRef.current.reportError(friendlyError(e))).finally(() => setLoaded(true))
  }, [])
  const save = useCallback((chat: Chat) => {
    chats.current = { ...chats.current, [chat.id]: chat }; setByID(chats.current)
    void k.save(chat).catch(e => envRef.current.reportError(`This chat could not be saved: ${friendlyError(e)}`))
  }, [])
  const chatTileID = (chatID: string) => envRef.current.desktop.tiles.find(t => t.kind === 'chat' && t.ref === chatID && t.status === 'visible')?.id
  const openArtifact = useCallback((artifactID: string, mode: OpenMode = 'here') => {
    const found = artifactOf(Object.values(chats.current), artifactID)
    if (!found) { envRef.current.notify('That document is no longer here.'); return }
    envRef.current.open(artifactTile(found.artifact, found.chat.id), mode)
  }, [])
  const markTiled = useCallback((chatID: string) => { const chat = chats.current[chatID]; if (chat && !chat.tile) save({ ...chat, tile: true }) }, [save])
  const continueInTile = useCallback((chatID: string, mode: OpenMode = 'here') => {
    markTiled(chatID)
    envRef.current.open(chatTile(chats.current[chatID] || { id: chatID, title: 'New chat' }), mode)
  }, [markTiled])
  const ask = useCallback(async (chatID: string | undefined, text: string, context: ContextItem[] = []) => {
    const now = Date.now(), id = chatID || uid()
    let chat = chats.current[id] || blank(id, text, now)
    chat = { ...chat, title: chat.turns.length ? chat.title : chatTitle(text), updated: now, turns: [...chat.turns, { id: uid(), role: 'user', text, time: now, ...(context.length && { context: context.map(c => c.name) }) }] }
    save(chat)
    setPending(p => [...p, id])
    try {
      const raw = await k.reply(kMessages(chat, context.filter(c => c.text).map(c => ({ name: c.name, text: c.text! }))))
      const result = applyReply(chats.current[id] || chat, raw, Date.now(), uid)
      save(result.chat)
      // A document made in a Chat tile opens beside it; the chat keeps the focus.
      const tileID = chatTileID(id)
      if (result.artifact && tileID) {
        const shown = envRef.current.desktop.tiles.some(t => t.kind === 'artifact' && t.ref === result.artifact!.id && t.status === 'visible')
        if (!shown) { envRef.current.open(artifactTile(result.artifact, tileID)); envRef.current.focus(tileID) }
      }
      return result
    } catch (e) {
      const failed: Chat = { ...(chats.current[id] || chat), turns: [...(chats.current[id] || chat).turns, { id: uid(), role: 'k', text: friendlyError(e), time: Date.now(), error: true }] }
      save(failed)
      return { chat: failed }
    } finally { setPending(p => p.filter(x => x !== id)) }
  }, [save])
  const remove = useCallback(async (chatID: string) => {
    if (!await k.remove(chatID).catch(e => { envRef.current.reportError(friendlyError(e)); return false })) return false
    const gone = chats.current[chatID], { [chatID]: _gone, ...rest } = chats.current
    chats.current = rest; setByID(rest)
    const ids = new Set([chatID, ...(gone?.artifacts.map(a => a.id) || [])])
    envRef.current.setDesktop(s => s.tiles.filter(t => (t.kind === 'chat' || t.kind === 'artifact') && ids.has(t.ref!) && isLive(t)).reduce((next, t) => hideTile(next, t.id, true), s))
    envRef.current.notify(`Deleted “${gone?.title || 'chat'}”.`)
    return true
  }, [])
  // Tiles follow their chat's and document's titles.
  useEffect(() => {
    envRef.current.setDesktop(s => {
      let changed = false
      const tiles = s.tiles.map(t => {
        const title = t.kind === 'chat' ? byID[t.ref!]?.title : t.kind === 'artifact' ? artifactOf(Object.values(byID), t.ref!)?.artifact.title : undefined
        if (!title || title === t.title) return t
        changed = true; return { ...t, title }
      })
      return changed ? { ...s, tiles } : s
    })
  }, [byID])
  const chatList = Object.values(byID).sort((a, b) => b.updated - a.updated)
  return { ready: !!env.model?.ready, loaded, chats: chatList, byID, pending, ask, continueInTile, openArtifact, remove, markTiled }
}
