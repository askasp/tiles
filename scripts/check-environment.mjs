import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { statSync } from 'node:fs'

const verbose = process.argv.includes('--verbose')
if (process.platform === 'linux') {
  try {
    const require = createRequire(import.meta.url)
    const executable = require('electron')
    const helper = join(dirname(executable), 'chrome-sandbox')
    const metadata = statSync(helper)
    if (metadata.uid !== 0 || (metadata.mode & 0o7777) !== 0o4755) {
      const quoted = `'${helper.replaceAll("'", "'\\''")}'`
      console.error([
        'ChatOS: Electron’s Linux sandbox helper needs one-time setup.',
        `Current helper: ${helper}`,
        `Current UID: ${metadata.uid}; mode: ${(metadata.mode & 0o7777).toString(8)}`,
        '',
        'Run these commands in your terminal (sudo will ask for your password):',
        `  sudo chown root:root ${quoted}`,
        `  sudo chmod 4755 ${quoted}`,
        '',
        'Then retry npm run dev. Repeat if reinstalling Electron replaces the helper.',
        'ChatOS will not disable the sandbox or change system-wide security settings.',
      ].join('\n'))
      process.exitCode = 1
    } else if (verbose) console.log('Electron Linux sandbox helper is configured (root-owned, mode 4755).')
  } catch (error) {
    console.error(`Unable to check Electron: ${error instanceof Error ? error.message : String(error)}\nRun npm install first.`)
    process.exitCode = 1
  }
} else if (verbose) console.log('No Linux SUID sandbox setup is needed on this platform.')
