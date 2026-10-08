import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell } from 'electron'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import type { CoreAPI, DesktopEvent } from '../shared/types'
import { mainSources, type MainContext, type MainSource } from './registry'
import { Browsers } from './browser'
import { shortcutFor } from '../shared/shortcuts'
import { readShortcut } from './keys'
import { Files } from './files'
import { Storage } from './storage'
import { Connectors } from './connectors'
import { ModelBroker } from './model'
import { Terminals } from './terminal'

const here = dirname(fileURLToPath(import.meta.url))
let window: BrowserWindow | undefined
let sources: MainSource[] = []
let browsers: Browsers | undefined
let storage: Storage | undefined
let connectors: Connectors | undefined
let model: ModelBroker | undefined
let terminals: Terminals | undefined
const files = new Files()
// While a terminal has focus or a dialog is open, plain Ctrl chords (Ctrl+W, Ctrl+K…) belong to it.
const keyModes = new Set<'terminal' | 'overlay'>()

// Tests use an isolated profile; never overwrite the user's desktop state.
if (process.env.CHATOS_USER_DATA) app.setPath('userData', process.env.CHATOS_USER_DATA)
app.setName('ChatOS')
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus() })

function emit(event: DesktopEvent) {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('chatos:event', event)
}

function registerIPC() {
  const channel = (name: string, handler: (...args: never[]) => unknown) => {
    ipcMain.removeHandler(`chatos:${name}`)
    ipcMain.handle(`chatos:${name}`, (event, ...args) => {
      // Remote pages have no preload, and cannot call the desktop bridge.
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Untrusted IPC sender')
      }
      return handler(...args as never[])
    })
  }
  const handle = <K extends Exclude<keyof CoreAPI, 'onEvent' | 'loadDesktop' | 'flushDesktop'>>(name: K, handler: (...args: Parameters<CoreAPI[K]>) => unknown) => channel(name, handler as (...args: never[]) => unknown)
  // Each added source exposes its own namespace: `chatos:opencode.sessions`, …
  for (const source of sources) for (const [method, fn] of Object.entries(source.api as unknown as Record<string, (...args: never[]) => unknown>)) channel(`${source.id}.${method}`, fn)
  const browser = () => { if (!browsers) throw new Error('Not ready'); return browsers }
  const database = () => { if (!storage) throw new Error('Storage is unavailable'); return storage }
  const recipes = () => { if (!connectors) throw new Error('Connectors are unavailable'); return connectors }
  const ai = () => { if (!model) throw new Error('AI model is unavailable'); return model }
  handle('modelInfo', () => ai().info())
  handle('saveModel', input => ai().save(input))
  handle('forgetModelKey', () => ai().forget())
  handle('probeModel', input => ai().probe(input))
  handle('skipModel', () => ai().skip())
  handle('discoverSource', turns => ai().discover(turns))
  const shells = () => { if (!terminals) throw new Error('Not ready'); return terminals }
  handle('terminalOpen', async input => {
    const folder = await files.inspect(input?.cwd || homedir())
    return shells().open({ ...input, cwd: folder.kind === 'folder' ? folder.path : dirname(folder.path) })
  })
  handle('terminalInput', (id, data) => shells().input(id, data))
  handle('terminalResize', (id, cols, rows) => shells().resize(id, cols, rows))
  handle('terminalClose', id => shells().close(id))
  handle('keyMode', (mode, active) => {
    if (mode !== 'terminal' && mode !== 'overlay') return
    if (active === true) keyModes.add(mode); else keyModes.delete(mode)
    // A web page in a Browser tile may hold the keyboard; a dialog takes it back so typing lands in K.
    if (mode === 'overlay' && active === true && window && !window.webContents.isFocused()) window.webContents.focus()
  })
  handle('environment', () => ({ home: homedir(), platform: process.platform }))
  handle('theme', mode => {
    if (mode !== undefined) {
      if (!['system', 'light', 'dark'].includes(mode)) throw new Error('Unknown theme')
      nativeTheme.themeSource = mode; database().set('theme', mode)
    }
    return nativeTheme.themeSource
  })
  handle('readImage', path => files.image(path))
  handle('findPaths', query => files.findPaths(query, homedir()))
  for (const channel of ['storage-load', 'storage-flush']) {
    ipcMain.removeAllListeners(`chatos:${channel}`)
    ipcMain.on(`chatos:${channel}`, (event, input) => {
      try {
        if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted storage sender')
        event.returnValue = { value: channel === 'storage-load' ? database().loadDesktop(input) : database().saveDesktop(input) }
      } catch (e) { event.returnValue = { error: e instanceof Error ? e.message : 'Storage operation failed' } }
    })
  }
  handle('saveDesktop', raw => database().saveDesktop(raw))
  handle('backupStorage', () => database().backup())
  handle('connectors', () => recipes().list())
  handle('saveConnector', (definition, revision) => recipes().save(definition, revision))
  handle('connectorRevisions', id => database().revisions(id))
  handle('connectorToken', (id, token) => recipes().setToken(id, token))
  handle('connectorOAuth', (id, secret) => recipes().connectOAuth(id, secret))
  handle('disconnectConnector', id => recipes().disconnect(id))
  handle('builtinConnector', id => recipes().builtin(id))
  handle('addBuiltinConnector', id => recipes().addBuiltin(id))
  handle('removeConnector', id => recipes().remove(id))
  handle('connectorSettings', (id, values) => recipes().saveSettings(id, values))
  handle('proposeConnector', input => recipes().propose(input))
  handle('searchConnectors', (query, id) => recipes().search(query, id))
  handle('planConnectorSearch', query => recipes().planSearch(query))
  handle('readRecipe', (ref, cursor) => recipes().read(ref, cursor))
  handle('recipeAction', (ref, operation, draft) => recipes().action(ref, operation, draft))
  handle('inspectPath', path => files.inspect(path))
  handle('listFolder', path => files.list(path))
  handle('readTextFile', path => files.read(path))
  handle('chooseFolder', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'], title: 'Open a project folder' })
    return result.canceled ? null : result.filePaths[0]
  })
  handle('chooseFiles', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openFile', 'multiSelections'], title: 'Attach context to your message' })
    return result.canceled ? [] : result.filePaths.map(path => ({ uri: pathToFileURL(path).href, name: basename(path) }))
  })
  handle('browserLayout', placements => browser().layout(placements))
  handle('browserAction', input => browser().action(input))
  handle('browserClose', id => browser().close(id))
  handle('browserContext', (id, selection) => browser().context(id, selection))
  handle('browserScreenshot', id => browser().screenshot(id))
}

async function createWindow() {
  // The theme is applied before the window exists, so the first frame already matches.
  const savedTheme = (storage ||= new Storage(app.getPath('userData'))).get('theme')
  if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') nativeTheme.themeSource = savedTheme
  window = new BrowserWindow({
    title: 'ChatOS', width: 1440, height: 940, minWidth: 950, minHeight: 620,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f0e' : '#e4e2dc', show: false,
    ...(process.platform === 'darwin' && { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, spellcheck: false,
    },
  })
  storage ||= new Storage(app.getPath('userData'))
  const secrets = {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (value: string) => safeStorage.encryptString(value), decrypt: (value: Buffer) => safeStorage.decryptString(value),
  }
  // Optional sources (e.g. OpenCode). Each is contacted only once the person added it.
  for (const source of sources) source.dispose()
  const store = storage
  sources = (Object.entries(mainSources) as [string, (ctx: MainContext) => MainSource][]).map(([id, create]) => create({ emit: event => emit({ type: 'source', source: id, event }), storage: store, secrets, env: process.env, home: homedir(), platform: process.platform }))
  browsers = new Browsers(window, emit)
  terminals = new Terminals(emit)
  const confirm = async (title: string, detail: string) => {
    if (!window) return false
    return (await dialog.showMessageBox(window, { type: 'question', title, message: title, detail, buttons: ['Cancel', 'Approve'], defaultId: 0, cancelId: 0, noLink: true })).response === 1
  }
  model ||= new ModelBroker(storage, secrets, confirm)
  connectors ||= new Connectors(storage, secrets, confirm, prompt => model!.generate(prompt), undefined, undefined, url => shell.openExternal(url))
  registerIPC()
  files.warm(homedir())
  window.on('ready-to-show', () => window?.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('before-input-event', (event, input) => {
    // A terminal or open dialog keeps plain Ctrl keys (Ctrl+W deletes a word in a shell); the renderer handles the rest.
    const system = input.meta || (input.control && input.alt)
    if (keyModes.size && !system && input.control && shortcutFor(input) !== 'attach-selection') return
    const { action, swallow } = readShortcut(input)
    if (swallow) event.preventDefault()
    if (action) emit({ type: 'shortcut', action })
  })
  window.on('closed', () => {
    connectors?.dispose()
    for (const source of sources) source.dispose()
    browsers?.dispose()
    terminals?.dispose()
    window = undefined; sources = []; browsers = undefined; terminals = undefined
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'ChatOS', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'quit' as const }] }] : []),
    { label: 'File', submenu: [
      { label: 'Ask or open… (K)', click: () => emit({ type: 'shortcut', action: 'launcher' }) },
      { label: 'New terminal', click: () => emit({ type: 'shortcut', action: 'new-terminal' }) },
      { label: 'Settings', click: () => emit({ type: 'shortcut', action: 'settings' }) },
      { label: 'Shelf focused tile (session keeps running)', click: () => emit({ type: 'shortcut', action: 'shelf-tile' }) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Overview', click: () => emit({ type: 'shortcut', action: 'overview' }) },
      { label: 'Toggle pane fullscreen', click: () => emit({ type: 'shortcut', action: 'fullscreen' }) },
      { type: 'separator' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    ] },
  ]))
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(here, '../renderer/index.html'))
}

app.whenReady().then(() => primary ? createWindow() : undefined).catch(error => {
  dialog.showErrorBox('ChatOS could not open local storage', `${error instanceof Error ? error.message : 'Startup failed'}\nNo database has been reset. Restore a backup or check filesystem permissions before restarting.`)
  app.quit()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (!window) void createWindow() })
app.on('will-quit', () => { storage?.close(); storage = undefined })
