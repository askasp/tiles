import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error The startup helper is native Node ESM, not compiled TS.
import { electronInstallation } from '../scripts/electron-installation.mjs'

const directories: string[] = []
function fixture(platform = 'darwin') {
  const directory = mkdtempSync('/tmp/opencode/chatos-electron-install-'); directories.push(directory)
  const marker = platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron'
  const executable = join(directory, 'dist', marker)
  mkdirSync(join(directory, 'dist', ...(platform === 'darwin' ? ['Electron.app', 'Contents', 'MacOS'] : [])), { recursive: true })
  writeFileSync(join(directory, 'package.json'), '{"version":"44.7.0"}')
  writeFileSync(join(directory, 'dist', 'version'), '44.7.0')
  writeFileSync(join(directory, 'path.txt'), marker)
  writeFileSync(executable, 'fixture executable'); chmodSync(executable, 0o755)
  return { directory, executable }
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
describe('cross-platform Electron startup validation', () => {
  it('recognizes installed macOS, Linux and Windows executables without importing Electron', () => {
    for (const platform of ['darwin', 'linux', 'win32']) { const f = fixture(platform); expect(electronInstallation(f.directory, platform)).toBe(f.executable) }
  })
  it('detects the missing marker that makes electron-vite throw Electron uninstall', () => {
    const f = fixture(); rmSync(join(f.directory, 'path.txt'))
    expect(() => electronInstallation(f.directory, 'darwin')).toThrow('path.txt')
  })
  it('detects an incomplete extraction and does not download or replace anything', () => {
    const f = fixture(); rmSync(f.executable)
    expect(() => electronInstallation(f.directory, 'darwin')).toThrow()
  })
  it('rejects a stale binary or node_modules copied from a different platform', () => {
    const f = fixture('linux')
    expect(() => electronInstallation(f.directory, 'darwin')).toThrow('not for darwin')
    writeFileSync(join(f.directory, 'dist', 'version'), '43.0.0')
    expect(() => electronInstallation(f.directory, 'linux')).toThrow('versions')
  })
  it('rejects non-executable files and supports electron-vite’s explicit executable override', () => {
    const f = fixture(); chmodSync(f.executable, 0o600)
    expect(() => electronInstallation(f.directory, 'darwin')).toThrow()
    chmodSync(f.executable, 0o755); rmSync(join(f.directory, 'path.txt'))
    expect(electronInstallation(f.directory, 'darwin', f.executable)).toBe(f.executable)
  })
})
