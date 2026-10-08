import { constants } from 'node:fs'
import { open, opendir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { execFile } from 'node:child_process'
import type { FolderEntry, FolderPage, LocalPath, TextFile } from '../shared/types'

const maxBytes = 256 * 1024
const maxImageBytes = 25 * 1024 * 1024
export const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' }
export const imageType = (path: string) => imageTypes[path.split('.').pop()?.toLowerCase() || '']
const skip = new Set(['node_modules', 'Library', 'AppData', 'Applications', 'snap', 'go', 'vendor', 'target', 'dist', 'build', 'out', '__pycache__', 'venv', '.venv', 'Pods', 'DerivedData'])
const hidden = (path: string, root: string) => path.slice(root.length).split('/').some(part => part.startsWith('.') || skip.has(part))
interface Entry { path: string; folder: boolean }
/** K finds folders and files by name. macOS asks Spotlight (instant, no privacy
 * prompts for protected folders); elsewhere a bounded walk of home is indexed
 * and refreshed at most once a minute. */
export class Files {
  private index?: { root: string; at: number; entries: Entry[] }
  private building?: Promise<Entry[]>
  constructor(private platform = process.platform) {}
  private async walk(root: string): Promise<Entry[]> {
    const entries: Entry[] = [], queue: [string, number][] = [[root, 0]]
    let visited = 0
    while (queue.length && visited < 20_000 && entries.length < 80_000) {
      const [dir, depth] = queue.shift()!
      visited++
      let handle
      try { handle = await opendir(dir) } catch { continue }
      try {
        for await (const entry of handle) {
          if (entry.name.startsWith('.') || skip.has(entry.name)) continue
          const path = join(dir, entry.name)
          if (entry.isDirectory()) { entries.push({ path, folder: true }); if (depth < 4) queue.push([path, depth + 1]) }
          else if (entry.isFile() && depth < 4) entries.push({ path, folder: false })
        }
      } catch { /* Unreadable folder. */ }
    }
    return entries
  }
  /** Builds the index in the background so the first K query is instant. */
  warm(root: string) { if (this.platform !== 'darwin') void this.indexed(root).catch(() => {}) }
  private async indexed(root: string): Promise<Entry[]> {
    if (this.index?.root === root && Date.now() - this.index.at < 60_000) return this.index.entries
    this.building ||= this.walk(root).then(entries => { this.index = { root, at: Date.now(), entries }; return entries }).finally(() => { this.building = undefined })
    // A stale index answers immediately while a fresh one builds.
    return this.index?.root === root ? this.index.entries : this.building
  }
  private spotlight(query: string, root: string): Promise<Entry[] | undefined> {
    return new Promise(resolve => execFile('/usr/bin/mdfind', ['-onlyin', root, '-name', query], { timeout: 6_000, maxBuffer: 8_000_000 }, async (error, stdout) => {
      if (error && !stdout) { resolve(undefined); return }
      const paths = stdout.split('\n').filter(p => p.startsWith(root) && !hidden(p, root)).sort((a, b) => a.split('/').length - b.split('/').length).slice(0, 300)
      const entries: Entry[] = []
      for (const path of paths) { try { const info = await stat(path); if (info.isDirectory() || info.isFile()) entries.push({ path, folder: info.isDirectory() }) } catch { /* Gone since indexing. */ } }
      resolve(entries)
    }))
  }
  async findPaths(query: string, root: string): Promise<LocalPath[]> {
    if (typeof query !== 'string' || query.length > 200 || !isAbsolute(root)) return []
    const needle = query.trim().toLowerCase()
    if (needle.length < 2 || needle.includes('/')) return []
    // macOS: Spotlight first (fast, no privacy prompts); if it has nothing, the home index.
    const spotlight = this.platform === 'darwin' ? await this.spotlight(query.trim(), root) : undefined
    const entries = spotlight?.length ? spotlight : await this.indexed(root)
    const scored = entries.map(entry => { const name = basename(entry.path).toLowerCase(), stem = name.replace(/\.[^.]+$/, ''); return { ...entry, score: (name === needle || stem === needle ? 4 : name.startsWith(needle) ? 3 : name.includes(needle) ? 1 : 0) + (entry.folder ? 0.5 : 0) } })
      .filter(f => f.score >= 1).sort((a, b) => b.score - a.score || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    return scored.slice(0, 8).map(f => ({ path: f.path, kind: f.folder ? 'folder' as const : 'file' as const, name: basename(f.path) }))
  }
  async inspect(path: string): Promise<LocalPath> {
    if (typeof path !== 'string' || path.length > 4096 || !isAbsolute(path) || path.includes('\0')) throw new Error('Use an absolute local file or folder path')
    const resolved = await realpath(path)
    // These pseudo files may masquerade as regular files and block indefinitely.
    if (/^\/(proc|sys|dev)(\/|$)/.test(resolved)) throw new Error('Device and system pseudo-files are not supported')
    const info = await stat(resolved)
    if (!info.isDirectory() && !info.isFile()) throw new Error('Only regular files and folders can be opened')
    return { path: resolved, kind: info.isDirectory() ? 'folder' : 'file', name: basename(resolved) || '/' }
  }
  async list(path: string): Promise<FolderPage> {
    const target = await this.inspect(path)
    if (target.kind !== 'folder') throw new Error('This path is not a folder')
    const entries: FolderEntry[] = []
    let truncated = false
    for await (const entry of await opendir(target.path)) {
      if (entries.length === 1000) { truncated = true; break }
      entries.push({ name: entry.name, path: join(target.path, entry.name), kind: entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'link' : 'other' })
    }
    entries.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name))
    return { path: target.path, parent: dirname(target.path), entries, truncated }
  }
  /** Images render through <img>, so SVG scripts never run. */
  async image(path: string): Promise<{ path: string; size: number; dataURL: string }> {
    const target = await this.inspect(path)
    const type = imageType(target.path)
    if (target.kind !== 'file' || !type) throw new Error('This file is not a supported image')
    const file = await open(target.path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile()) throw new Error('Only regular files can be read')
      if (info.size > maxImageBytes) throw new Error('Image is larger than 25 MB — preview is not available.')
      const data = await file.readFile()
      return { path: target.path, size: info.size, dataURL: `data:${type};base64,${data.toString('base64')}` }
    } finally { await file.close() }
  }
  async read(path: string): Promise<TextFile> {
    const target = await this.inspect(path)
    if (target.kind !== 'file') throw new Error('This path is not a regular file')
    const file = await open(target.path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      if (!info.isFile()) throw new Error('Only regular files can be read')
      const buffer = Buffer.alloc(maxBytes + 1)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      const data = buffer.subarray(0, Math.min(bytesRead, maxBytes))
      const result = { path: target.path, size: info.size, truncated: bytesRead > maxBytes || info.size > maxBytes }
      if (data.includes(0)) return { ...result, reason: 'Binary file — text preview is not available.' }
      try { return { ...result, text: new TextDecoder('utf-8', { fatal: true }).decode(data, { stream: result.truncated }) } }
      catch { return { ...result, reason: 'This file is not UTF-8 text — preview is not available.' } }
    } finally { await file.close() }
  }
}
