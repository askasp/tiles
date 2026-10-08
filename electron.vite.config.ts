import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// React Fast Refresh injects a small module preamble in development only.
// The packaged renderer keeps the stricter, self-only script policy.
export const developmentCSP: Plugin = {
  name: 'chatos-development-csp',
  transformIndexHtml: {
    order: 'post',
    handler: (html, context) => context.server ? html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';") : html,
  },
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), developmentCSP],
    build: { minify: 'esbuild', rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
