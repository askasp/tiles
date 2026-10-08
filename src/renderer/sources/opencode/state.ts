import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionInfo, OpenCodeEvent, SessionDetail, SessionInfo, SessionPage, Snapshot } from '../../../shared/sources/opencode/types'
import { api, friendlyError } from '../../data'
export { friendlyError }

/** OpenCode's namespace on the desktop bridge. */
export const opencode = api.opencode
export function onOpenCodeEvent(listener: (event: OpenCodeEvent) => void) {
  return api.onEvent(event => { if (event.type === 'source' && event.source === 'opencode') listener(event.event as OpenCodeEvent) })
}

/** OpenCode's live data: connection, sessions, running and waiting state. */
export function useOpenCodeData(onError: (message: string) => void) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionInfo>({ connected: false, automatic: true })
  const [sessions, setSessions] = useState<Record<string, SessionInfo>>({})
  const [active, setActive] = useState<string[]>([])
  const [details, setDetails] = useState<Record<string, SessionDetail>>({})
  const [loading, setLoading] = useState(true)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<string[]>([])
  const watched = useRef(new Set<string>())
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const busy = useRef(new Set<string>())
  const revisions = useRef(new Map<string, number>())
  const mounted = useRef(true)
  const errorRef = useRef(onError)
  const connected = useRef(false)
  errorRef.current = onError

  const ingest = useCallback((items: SessionInfo[]) => {
    setSessions(previous => ({ ...previous, ...Object.fromEntries(items.map(session => [session.id, session])) }))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await opencode.bootstrap()
      if (!mounted.current) return
      connected.current = data.connection.connected
      setSnapshot(data); setConnection(data.connection); setActive(data.active); ingest(data.sessions.data)
    } catch (error) { errorRef.current(friendlyError(error)) }
    finally { if (mounted.current) setLoading(false) }
  }, [ingest])

  const refreshSession = useCallback(async (id: string, foreground = false) => {
    if (!connected.current || busy.current.has(id)) return
    busy.current.add(id)
    const revision = revisions.current.get(id) || 0
    if (foreground) setLoadingSession(id)
    try {
      const detail = await opencode.session(id)
      if (!mounted.current) return
      // Preserve older loaded pages and stable message objects for React.memo.
      setDetails(previous => {
        const old = previous[id]
        const oldMessages = new Map(old?.messages.data.map(m => [m.id, m]))
        const newest = detail.messages.data.map(message => {
          const existing = oldMessages.get(message.id)
          return existing && JSON.stringify(existing) === JSON.stringify(message) ? existing : message
        })
        const oldest = newest.at(-1)?.time.created ?? Infinity
        const history = old?.messages.data.filter(message => message.time.created < oldest && !newest.some(m => m.id === message.id)) || []
        return {
          ...previous,
          [id]: { ...detail, messages: { data: [...newest, ...history], cursor: history.length ? old!.messages.cursor : detail.messages.cursor } },
        }
      })
      ingest([detail.session])
      setWaiting(previous => detail.permissions.length || detail.forms.length ? previous.includes(id) ? previous : [...previous, id] : previous.includes(id) ? previous.filter(x => x !== id) : previous)
    } catch (error) {
      if (foreground) errorRef.current(friendlyError(error))
    } finally {
      busy.current.delete(id)
      if (mounted.current) {
        setLoadingSession(current => current === id ? null : current)
        if ((revisions.current.get(id) || 0) !== revision) {
          if (!pending.current.has(id)) {
            pending.current.set(id, setTimeout(() => { pending.current.delete(id); void refreshSession(id) }, 300))
          }
        }
      }
    }
  }, [ingest])

  const watchSessions = useCallback((ids: string[]) => {
    const previous = watched.current
    watched.current = new Set(ids)
    for (const id of ids) if (!previous.has(id)) void refreshSession(id, true)
  }, [refreshSession])

  const olderMessages = useCallback(async (id: string) => {
    const cursor = details[id]?.messages.cursor.next
    if (!cursor) return
    const page = await opencode.messages(id, cursor)
    setDetails(previous => {
      const old = previous[id]
      if (!old) return previous
      const known = new Set(old.messages.data.map(m => m.id))
      return { ...previous, [id]: { ...old, messages: { data: [...old.messages.data, ...page.data.filter(m => !known.has(m.id))], cursor: page.cursor } } }
    })
  }, [details])

  useEffect(() => {
    mounted.current = true
    void load()
    const unsubscribe = onOpenCodeEvent(event => {
      if (event.type === 'connection') {
        connected.current = event.connection.connected; setConnection(event.connection)
        if (!event.connection.connected) {
          setActive([]); setWaiting([])
          for (const timer of pending.current.values()) clearTimeout(timer)
          pending.current.clear()
        }
        return
      }
      if (event.type !== 'server') return
      const type = String(event.event.type)
      const payload = event.event.data as Record<string, unknown> | undefined
      const id = payload && typeof payload.sessionID === 'string' ? payload.sessionID : undefined
      if (id) {
        if (type === 'session.execution.started') setActive(previous => [...new Set([...previous, id])])
        if (['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted', 'session.idle'].includes(type)) {
          setActive(previous => previous.filter(current => current !== id))
        }
        if (type === 'session.renamed' && typeof payload?.title === 'string') {
          setSessions(previous => previous[id] ? { ...previous, [id]: { ...previous[id], title: payload.title as string } } : previous)
        }
        revisions.current.set(id, (revisions.current.get(id) || 0) + 1)
        const attention = /^(permission\.|form\.)/.test(type)
        if (type === 'permission.asked' || type === 'form.created') setWaiting(previous => previous.includes(id) ? previous : [...previous, id])
        if ((watched.current.has(id) || attention) && !pending.current.has(id) && !busy.current.has(id)) {
          // Throttle, rather than debounce: long streams update continuously.
          pending.current.set(id, setTimeout(() => { pending.current.delete(id); void refreshSession(id) }, 350))
        }
      }
    })
    const reconcile = setInterval(() => {
      if (connected.current && !document.hidden) {
        void opencode.activeSessions().then(setActive).catch(() => {})
        for (const id of watched.current) void refreshSession(id)
      }
    }, 8_000)
    return () => {
      mounted.current = false; unsubscribe(); clearInterval(reconcile)
      for (const timer of pending.current.values()) clearTimeout(timer)
      pending.current.clear()
    }
  }, [load, refreshSession])

  useEffect(() => {
    if (connection.connected) for (const id of watched.current) void refreshSession(id)
  }, [connection.connected, refreshSession])

  return { snapshot, connection, sessions, active, waiting, details, loading, loadingSession, ingest, load, refreshSession, watchSessions, olderMessages }
}

export function useSessionList(query: { directory?: string; project?: string; search?: string }, enabled: boolean, ingest: (items: SessionInfo[]) => void) {
  const [page, setPage] = useState<SessionPage>({ data: [], cursor: {} })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const key = JSON.stringify(query)
  const generation = useRef(0)
  const queryRef = useRef(query)
  queryRef.current = query

  const refresh = useCallback(async (cursor?: string, silent = false) => {
    if (!enabled) return
    const version = ++generation.current
    if (!silent) setLoading(true)
    try {
      const result = await opencode.sessions({ ...queryRef.current, ...(cursor && { cursor }) })
      if (version !== generation.current) return
      ingest(result.data)
      setPage(previous => cursor
        ? { ...result, data: [...previous.data, ...result.data.filter(s => !previous.data.some(old => old.id === s.id))] }
        : result)
      setError(undefined)
    } catch (error) { if (version === generation.current) setError(friendlyError(error)) }
    finally { if (version === generation.current) setLoading(false) }
  }, [enabled, ingest])

  useEffect(() => {
    generation.current++
    setPage({ data: [], cursor: {} })
    const timer = setTimeout(() => { void refresh() }, queryRef.current.search ? 200 : 0)
    return () => { clearTimeout(timer); generation.current++ }
  }, [key, refresh])

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = onOpenCodeEvent(event => {
      if (event.type === 'server' && ['session.created', 'session.renamed', 'session.moved'].includes(String(event.event.type)) && !timer) {
        timer = setTimeout(() => { timer = undefined; void refresh(undefined, true) }, 600)
      }
    })
    return () => { unsubscribe(); clearTimeout(timer) }
  }, [enabled, refresh])

  return { page, loading, error, refresh }
}
