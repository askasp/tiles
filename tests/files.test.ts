import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises'
import { Files } from '../src/main/files'
import { desktopInitial, fileTile, openTile, serializeDesktop } from '../src/shared/tiles'
import { projectTile } from '../src/shared/sources/opencode'
import { restore as restoreDesktop } from '../src/shared/registry'

describe('read-only local Files source', () => {
  it('lists folders and previews executable markup only as text without writing anything', async () => {
    const root = await mkdtemp('/tmp/opencode/chatos-files-')
    try {
      const files = new Files()
      await mkdir(`${root}/nested`)
      await writeFile(`${root}/index.html`, '<script>bad()</script><img src="https://track.test/">')
      await symlink(`${root}/index.html`, `${root}/alias`)
      const page = await files.list(root)
      expect(page.entries[0].kind).toBe('folder'); expect(page.parent).toBe('/tmp/opencode')
      expect(page.entries.find(e => e.name === 'alias')?.kind).toBe('link')
      expect(await files.inspect(`${root}/alias`)).toMatchObject({ path: `${root}/index.html`, kind: 'file' })
      expect((await files.read(`${root}/index.html`)).text).toBe(await readFile(`${root}/index.html`, 'utf8'))
      await expect(files.read(root)).rejects.toThrow('regular file')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('bounds text reads and rejects binary/non-UTF8 and system pseudo-files', async () => {
    const root = await mkdtemp('/tmp/opencode/chatos-file-bounds-')
    try {
      const files = new Files()
      await writeFile(`${root}/large`, 'x'.repeat(300_000))
      expect(await files.read(`${root}/large`)).toMatchObject({ truncated: true, size: 300_000 })
      expect((await files.read(`${root}/large`)).text?.length).toBe(256 * 1024)
      await writeFile(`${root}/binary`, Buffer.from([0, 1, 2]))
      expect((await files.read(`${root}/binary`)).reason).toContain('Binary')
      await writeFile(`${root}/non-utf8`, Buffer.from([0xff, 0xfe]))
      expect((await files.read(`${root}/non-utf8`)).text).toBeUndefined()
      await expect(files.inspect('relative/file')).rejects.toThrow('absolute')
      await expect(files.inspect('/dev/zero')).rejects.toThrow('pseudo-files')
      await symlink('/dev/zero', `${root}/device`)
      await expect(files.read(`${root}/device`)).rejects.toThrow('pseudo-files')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('keeps folder, file and OpenCode project resources separate and persisted without content', () => {
    let state = openTile(desktopInitial(), fileTile('/home/me/chatos'))
    state = openTile(state, fileTile('/home/me/chatos'))
    state = openTile(state, projectTile('/home/me/chatos'))
    state = openTile(state, fileTile('/home/me/chatos/a.ts', 'file'))
    const restored = restoreDesktop(serializeDesktop(state))
    expect(restored.tiles.map(t => t.key)).toEqual(['folder:/home/me/chatos', 'project:/home/me/chatos', 'file:/home/me/chatos/a.ts'])
    expect(restored.tiles.some(t => t.kind === 'session')).toBe(false)
  })
})
