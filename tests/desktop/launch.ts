import { _electron as electron } from '@playwright/test'
import { createRequire } from 'node:module'

export function launchDesktop(env: Record<string, string>) {
  const require = createRequire(import.meta.url)
  return electron.launch({
    executablePath: require('electron') as string,
    // Playwright defaults this to false and otherwise silently adds --no-sandbox.
    // Test the exact installed Electron binary and security settings users run.
    chromiumSandbox: true,
    args: ['.'], cwd: process.cwd(), env,
  })
}
