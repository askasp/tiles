import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Check without importing Electron: its entrypoint can download binaries. */
export function electronInstallation(directory, platform, explicitPath) {
  let executable
  if (explicitPath) executable = explicitPath
  else {
    const expected = platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : platform === 'win32' ? 'electron.exe' : 'electron'
    const marker = readFileSync(join(directory, 'path.txt'), 'utf8').trim()
    if (marker !== expected) throw new Error(`Electron's installed executable is not for ${platform}.`)
    const installedVersion = readFileSync(join(directory, 'dist', 'version'), 'utf8').trim().replace(/^v/, '')
    const packageVersion = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version
    if (installedVersion !== packageVersion) throw new Error('Electron package and downloaded binary versions do not match.')
    executable = join(directory, 'dist', marker)
  }
  if (!statSync(executable).isFile()) throw new Error('Electron executable is missing.')
  accessSync(executable, platform === 'win32' ? constants.F_OK : constants.X_OK)
  return executable
}
