import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DesktopEvent } from '../shared/types'

const replayLimit = 256 * 1024
const size = (value: number, max: number) => Math.max(2, Math.min(max, Math.floor(Number(value) || 0)))

/** What a running shell needs from its backend. */
interface Process { write(data: string): void; resize(cols: number, rows: number): void; kill(): void }
interface Shell { process: Process; cwd: string; shell: string; buffer: string; pending: string; timer?: ReturnType<typeof setTimeout>; alive: boolean }
type PtyModule = { spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv }): { onData(cb: (data: string) => void): void; onExit(cb: (e: { exitCode: number }) => void): void; write(data: string): void; resize(cols: number, rows: number): void; kill(signal?: string): void } }

/** A real pseudo-terminal from node-pty's prebuilt binaries (no compiling for Electron). */
function loadPty(): PtyModule | undefined {
  try { return createRequire(import.meta.url)('@lydell/node-pty') as PtyModule } catch { return undefined }
}

/**
 * Terminal tiles. node-pty provides a real pseudo-terminal on macOS, Linux and Windows. If it
 * can't load, Linux falls back to the system `script` command, which also allocates a pty
 * (macOS's BSD `script` can't: it needs a terminal on its own input).
 */
export class Terminals {
  private shells = new Map<string, Shell>()
  private directory = mkdtempSync(join(tmpdir(), 'chatos-tty-'))
  constructor(private emit: (event: DesktopEvent) => void, private platform = process.platform, private pty: PtyModule | null = loadPty() ?? null) {}

  private shellPath() {
    if (this.platform === 'win32') return process.env.COMSPEC || 'powershell.exe'
    return process.env.SHELL && /^\/[\w./+-]+$/.test(process.env.SHELL) ? process.env.SHELL : '/bin/bash'
  }
  private environment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'ChatOS' }
    delete env.ELECTRON_RUN_AS_NODE
    return env
  }
  open(input: { id: string; cwd: string; cols: number; rows: number }) {
    if (typeof input?.id !== 'string' || !/^[\w:-]{1,100}$/.test(input.id)) throw new Error('Invalid terminal')
    const existing = this.shells.get(input.id)
    if (existing?.alive) { this.resize(input.id, input.cols, input.rows); return { cwd: existing.cwd, shell: existing.shell, replay: existing.buffer, alive: true } }
    const shell = this.shellPath(), cols = size(input.cols, 500), rows = size(input.rows, 300)
    const entry: Shell = { process: undefined as unknown as Process, cwd: input.cwd, shell, buffer: existing?.buffer ? `${existing.buffer}\r\n` : '', pending: '', alive: true }
    const output = (text: string) => {
      entry.buffer = (entry.buffer + text).slice(-replayLimit)
      entry.pending += text
      // Coalesce bursts into one IPC message per frame.
      entry.timer ||= setTimeout(() => { entry.timer = undefined; const data = entry.pending; entry.pending = ''; if (data) this.emit({ type: 'terminal', id: input.id, data }) }, 12)
    }
    const ended = (code: number | null) => {
      if (!entry.alive) return
      entry.alive = false
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined }
      if (entry.pending) { this.emit({ type: 'terminal', id: input.id, data: entry.pending }); entry.pending = '' }
      this.emit({ type: 'terminal-exit', id: input.id, code })
    }
    if (this.pty) {
      const pty = this.pty.spawn(shell, this.platform === 'win32' ? [] : ['-l'], { name: 'xterm-256color', cols, rows, cwd: input.cwd, env: this.environment() })
      pty.onData(output)
      pty.onExit(({ exitCode }) => ended(exitCode))
      entry.process = { write: data => pty.write(data), resize: (c, r) => pty.resize(c, r), kill: () => { try { pty.kill(this.platform === 'win32' ? undefined : 'SIGHUP') } catch { /* Already gone. */ } } }
    } else {
      if (this.platform !== 'linux') throw new Error('Terminal tiles need node-pty on this system. Reinstall dependencies (npm install) and restart.')
      entry.process = this.scriptShell(input.id, input.cwd, shell, cols, rows, output, ended)
    }
    this.shells.set(input.id, entry)
    return { cwd: input.cwd, shell, replay: entry.buffer, alive: true }
  }
  /** Linux fallback: `script` allocates the pty; resizing sets its window size (delivering SIGWINCH). */
  private scriptShell(id: string, cwd: string, shell: string, cols: number, rows: number, output: (text: string) => void, ended: (code: number | null) => void): Process {
    const ttyFile = join(this.directory, `${id.replace(/\W/g, '_')}-${Date.now()}`)
    const inner = `tty > "$CHATOS_TTY_FILE"; stty rows ${rows} cols ${cols}; exec "$CHATOS_SHELL" -l`
    const child: ChildProcess = spawn('script', ['-qfec', `/bin/sh -c '${inner}'`, '/dev/null'], { cwd, env: { ...this.environment(), CHATOS_TTY_FILE: ttyFile, CHATOS_SHELL: shell }, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    child.stdout?.on('data', (chunk: Buffer) => output(chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => output(chunk.toString('utf8')))
    child.on('error', error => output(`\r\nCould not start a shell: ${error.message}\r\n`))
    child.on('exit', code => { rmSync(ttyFile, { force: true }); ended(code) })
    let tty: string | undefined
    return {
      write: data => { child.stdin?.write(data) },
      resize: (c, r) => {
        if (!tty) { try { tty = readFileSync(ttyFile, 'utf8').trim() } catch { return } }
        if (/^\/dev\/[\w/]+$/.test(tty)) execFile('stty', ['-F', tty, 'rows', String(r), 'cols', String(c)], () => {})
      },
      // `script` runs in its own process group: end the shell and anything it started.
      kill: () => { try { process.kill(-child.pid!, 'SIGHUP') } catch { child.kill('SIGHUP') } },
    }
  }
  input(id: string, data: string) {
    const entry = this.shells.get(id)
    if (!entry?.alive) throw new Error('This shell has ended')
    if (typeof data !== 'string' || data.length > 1_000_000) throw new Error('Input is too large')
    entry.process.write(data)
  }
  resize(id: string, cols: number, rows: number) {
    const entry = this.shells.get(id)
    if (entry?.alive) entry.process.resize(size(cols, 500), size(rows, 300))
  }
  close(id: string) {
    const entry = this.shells.get(id)
    this.shells.delete(id)
    if (entry?.alive) entry.process.kill()
  }
  dispose() {
    for (const id of [...this.shells.keys()]) this.close(id)
    rmSync(this.directory, { recursive: true, force: true })
  }
}
