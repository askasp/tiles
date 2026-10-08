import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DesktopEvent } from '../shared/types'

const replayLimit = 256 * 1024
const size = (value: number, max: number) => Math.max(2, Math.min(max, Math.floor(Number(value) || 0)))

interface Shell { process: ChildProcess; cwd: string; shell: string; tty?: string; ttyFile: string; buffer: string; pending: string; timer?: ReturnType<typeof setTimeout>; alive: boolean; cols: number; rows: number }

/**
 * Terminal tiles without a native pty module: the system `script` command
 * allocates a real pseudo-terminal, so shells, prompts and full-screen tools
 * behave normally. Resizing sets the pty window size, which also delivers
 * SIGWINCH to the foreground program.
 */
export class Terminals {
  private shells = new Map<string, Shell>()
  private directory = mkdtempSync(join(tmpdir(), 'chatos-tty-'))
  constructor(private emit: (event: DesktopEvent) => void, private platform = process.platform) {}

  open(input: { id: string; cwd: string; cols: number; rows: number }) {
    if (typeof input?.id !== 'string' || !/^[\w:-]{1,100}$/.test(input.id)) throw new Error('Invalid terminal')
    const existing = this.shells.get(input.id)
    if (existing?.alive) { this.resize(input.id, input.cols, input.rows); return { cwd: existing.cwd, shell: existing.shell, replay: existing.buffer, alive: true } }
    if (this.platform === 'win32') throw new Error('Terminal tiles currently need macOS or Linux.')
    const shell = process.env.SHELL && /^\/[\w./+-]+$/.test(process.env.SHELL) ? process.env.SHELL : '/bin/bash'
    const cols = size(input.cols, 500), rows = size(input.rows, 300)
    const ttyFile = join(this.directory, `${input.id.replace(/\W/g, '_')}-${Date.now()}`)
    // The inner script reports its tty so resizes can address it, sets the
    // first size, then becomes the user's login shell. No user text is interpolated.
    const inner = `tty > "$CHATOS_TTY_FILE"; stty rows ${rows} cols ${cols}; exec "$CHATOS_SHELL" -l`
    const args = this.platform === 'darwin' ? ['-q', '/dev/null', '/bin/sh', '-c', inner] : ['-qfec', `/bin/sh -c '${inner}'`, '/dev/null']
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', CHATOS_TTY_FILE: ttyFile, CHATOS_SHELL: shell, TERM_PROGRAM: 'ChatOS' }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn('script', args, { cwd: input.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    const entry: Shell = { process: child, cwd: input.cwd, shell, ttyFile, buffer: existing?.buffer ? `${existing.buffer}\r\n` : '', pending: '', alive: true, cols, rows }
    this.shells.set(input.id, entry)
    const output = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      entry.buffer = (entry.buffer + text).slice(-replayLimit)
      entry.pending += text
      // Coalesce bursts into one IPC message per frame.
      entry.timer ||= setTimeout(() => { entry.timer = undefined; const data = entry.pending; entry.pending = ''; if (data) this.emit({ type: 'terminal', id: input.id, data }) }, 12)
    }
    child.stdout?.on('data', output)
    child.stderr?.on('data', output)
    child.on('error', error => { output(Buffer.from(`\r\nCould not start a shell: ${error.message}\r\n`)) })
    child.on('exit', code => {
      entry.alive = false
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined }
      if (entry.pending) { this.emit({ type: 'terminal', id: input.id, data: entry.pending }); entry.pending = '' }
      rmSync(ttyFile, { force: true })
      this.emit({ type: 'terminal-exit', id: input.id, code })
    })
    return { cwd: input.cwd, shell, replay: entry.buffer, alive: true }
  }
  input(id: string, data: string) {
    const entry = this.shells.get(id)
    if (!entry?.alive) throw new Error('This shell has ended')
    if (typeof data !== 'string' || data.length > 1_000_000) throw new Error('Input is too large')
    entry.process.stdin?.write(data)
  }
  resize(id: string, cols: number, rows: number) {
    const entry = this.shells.get(id)
    if (!entry?.alive) return
    entry.cols = size(cols, 500); entry.rows = size(rows, 300)
    if (!entry.tty) { try { entry.tty = readFileSync(entry.ttyFile, 'utf8').trim() } catch { return } }
    if (!/^\/dev\/[\w/]+$/.test(entry.tty)) return
    execFile('stty', [this.platform === 'darwin' ? '-f' : '-F', entry.tty, 'rows', String(entry.rows), 'cols', String(entry.cols)], () => {})
  }
  close(id: string) {
    const entry = this.shells.get(id)
    this.shells.delete(id)
    if (!entry?.alive) return
    // `script` runs in its own process group: end the shell and anything it started.
    try { process.kill(-entry.process.pid!, 'SIGHUP') } catch { entry.process.kill('SIGHUP') }
  }
  dispose() {
    for (const id of [...this.shells.keys()]) this.close(id)
    rmSync(this.directory, { recursive: true, force: true })
  }
}
