import { constants } from 'node:fs'
import { open, opendir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { FolderEntry, FolderPage, LocalPath, TextFile } from '../shared/types'

const maxBytes = 256 * 1024
const maxImageBytes = 25 * 1024 * 1024
export const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml' }
export const imageType = (path: string) => imageTypes[path.split('.').pop()?.toLowerCase() || '']
const skip = new Set(['node_modules', 'Library', 'AppData', 'snap', 'go', 'vendor', 'target', 'dist', 'build', 'out', '__pycache__', 'venv', '.venv'])
/** K finds folders by name: a bounded walk of the home folder, refreshed at most once a minute. */
export class Files {
  private index?: { root: string; at: number; folders: string[]; pending?: Promise<string[]> }
  private async walk(root: string): Promise<string[]> {
    const folders: string[] = [], queue: [string, number][] = [[root, 0]]
    let visited = 0
    while (queue.length && visited < 20_000 && folders.length < 20_000) {
      const [dir, depth] = queue.shift()!
      visited++
      let entries
      try { entries = await opendir(dir) } catch { continue }
      try {
        for await (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || skip.has(entry.name)) continue
          const path = join(dir, entry.name)
          folders.push(path)
          if (depth < 3) queue.push([path, depth + 1])
        }
      } catch { /* Unreadable folder. */ }
    }
    return folders
  }
  async findFolders(query: string, root: string): Promise<LocalPath[]> {
    if (typeof query !== 'string' || query.length > 200 || !isAbsolute(root)) return []
    const needle = query.trim().toLowerCase()
    if (needle.length < 2 || needle.includes('/')) return []
    if (!this.index || this.index.root !== root || Date.now() - this.index.at > 60_000) {
      const pending = this.index?.root === root && this.index.pending || this.walk(root)
      this.index = { root, at: this.index?.root === root ? this.index.at : 0, folders: this.index?.root === root ? this.index.folders : [], pending }
      const folders = await pending
      this.index = { root, at: Date.now(), folders }
    }
    const scored = this.index.folders.map(path => { const name = basename(path).toLowerCase(); return { path, score: name === needle ? 3 : name.startsWith(needle) ? 2 : name.includes(needle) ? 1 : 0 } })
      .filter(f => f.score).sort((a, b) => b.score - a.score || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    return scored.slice(0, 6).map(f => ({ path: f.path, kind: 'folder', name: basename(f.path) }))
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
