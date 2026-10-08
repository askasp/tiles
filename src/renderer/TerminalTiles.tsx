import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { Tile } from '../shared/tiles'
import { api, friendlyError } from './data'

/** A shell in a folder. The process lives in the main process, so shelving
 * the tile keeps it running; reopening replays recent output. */
export function TerminalBody({ tile, visible, focused, focusKey }: { tile: Tile; visible: boolean; focused: boolean; focusKey: number }) {
  const host = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal>(undefined)
  const fit = useRef<FitAddon>(undefined)
  const [state, setState] = useState<{ alive: boolean; error?: string; shell?: string }>({ alive: true })
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (!host.current) return
    const terminal = new Terminal({
      fontFamily: "'Geist Mono Variable', ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.25, cursorBlink: true, scrollback: 5000, allowProposedApi: false,
      theme: { background: '#161514', foreground: '#e7e5e1', cursor: '#e7e5e1', selectionBackground: '#3a3833', green: '#7fc49a', brightGreen: '#9bd6b0', blue: '#6fb3df', brightBlue: '#8cc6ec' },
    })
    const fitter = new FitAddon()
    terminal.loadAddon(fitter); terminal.open(host.current)
    term.current = terminal; fit.current = fitter
    try { fitter.fit() } catch { /* Hidden tiles have no size yet. */ }
    let alive = true
    const unsubscribe = api.onEvent(event => {
      if (event.type === 'terminal' && event.id === tile.id) terminal.write(event.data)
      if (event.type === 'terminal-exit' && event.id === tile.id) { alive = false; setState(s => ({ ...s, alive: false })); terminal.write('\r\n\x1b[2m[shell ended · press Enter to start a new one]\x1b[0m\r\n') }
    })
    const input = terminal.onData(data => {
      if (!alive) { if (data === '\r') setGeneration(g => g + 1); return }
      void api.terminalInput(tile.id, data).catch(() => {})
    })
    const textarea = terminal.textarea
    const focusIn = () => { void api.terminalFocus(true).catch(() => {}) }, focusOut = () => { void api.terminalFocus(false).catch(() => {}) }
    textarea?.addEventListener('focus', focusIn); textarea?.addEventListener('blur', focusOut)
    const resize = terminal.onResize(({ cols, rows }) => { void api.terminalResize(tile.id, cols, rows).catch(() => {}) })
    void api.terminalOpen({ id: tile.id, cwd: tile.directory || '', cols: terminal.cols, rows: terminal.rows }).then(result => {
      if (result.replay) terminal.write(result.replay)
      setState({ alive: true, shell: result.shell.split('/').pop() })
    }).catch(e => { alive = false; setState({ alive: false, error: friendlyError(e) }) })
    return () => { unsubscribe(); input.dispose(); resize.dispose(); textarea?.removeEventListener('focus', focusIn); textarea?.removeEventListener('blur', focusOut); if (textarea === document.activeElement) focusOut(); terminal.dispose(); term.current = undefined }
  }, [tile.id, tile.directory, generation])
  useEffect(() => {
    if (!visible || !host.current) return
    const observer = new ResizeObserver(() => { try { fit.current?.fit() } catch { /* Not laid out yet. */ } })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [visible, generation])
  useEffect(() => { if (visible && focused) term.current?.focus() }, [visible, focused, focusKey, generation])
  return <div className="terminal-body">
    {state.error && <div className="inline-error" role="alert">{state.error}<button className="text-button" onClick={() => setGeneration(g => g + 1)}>Retry</button></div>}
    <div className="terminal-host" ref={host} data-terminal-id={tile.id} />
    <footer className="files-footer">{tile.directory}{state.shell && ` · ${state.shell}`}{!state.alive && !state.error && ' · ended'} · Closing the tile ends the shell; shelving keeps it running</footer>
  </div>
}
