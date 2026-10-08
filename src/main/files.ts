import { constants } from 'node:fs'
import { open, opendir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { FolderEntry, FolderPage, LocalPath, TextFile } from '../shared/types'

const maxBytes = 256 * 1024
export class Files {
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
