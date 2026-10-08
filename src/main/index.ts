import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import type { ChatOSAPI, DesktopEvent } from '../shared/types'
import { OpenCodeBridge } from './opencode'
import { Browsers } from './browser'
import { shortcutFor } from '../shared/shortcuts'
import { Services } from './services'
import { Files } from './files'
import { Storage } from './storage'
import { Connectors } from './connectors'
import { ModelBroker } from './model'
import { Terminals } from './terminal'

const here = dirname(fileURLToPath(import.meta.url))
let window: BrowserWindow | undefined
let bridge: OpenCodeBridge | undefined
let browsers: Browsers | undefined
let services: Services | undefined
let storage: Storage | undefined
let connectors: Connectors | undefined
let model: ModelBroker | undefined
let terminals: Terminals | undefined
const files = new Files()
// While a terminal has focus, plain Ctrl chords (Ctrl+W, Ctrl+L, Ctrl+K…) belong to the shell.
let terminalFocused = false

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
  const handle = <K extends keyof ChatOSAPI>(name: K, handler: (...args: Parameters<ChatOSAPI[K]>) => unknown) => {
    ipcMain.removeHandler(`chatos:${name}`)
    ipcMain.handle(`chatos:${name}`, (event, ...args) => {
      // Remote pages have no preload, and cannot call the desktop bridge.
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Untrusted IPC sender')
      }
      return handler(...args as Parameters<ChatOSAPI[K]>)
    })
  }
  const server = () => { if (!bridge) throw new Error('Not ready'); return bridge }
  const browser = () => { if (!browsers) throw new Error('Not ready'); return browsers }
  const integrations = () => { if (!services) throw new Error('Not ready'); return services }
  const database = () => { if (!storage) throw new Error('Storage is unavailable'); return storage }
  const recipes = () => { if (!connectors) throw new Error('Connectors are unavailable'); return connectors }
  const ai = () => { if (!model) throw new Error('AI model is unavailable'); return model }
  handle('modelInfo', () => ai().info())
  handle('saveModel', input => ai().save(input))
  handle('forgetModelKey', () => ai().forget())
  handle('probeModel', input => ai().probe(input))
  handle('skipModel', () => ai().skip())
  handle('discoverSource', turns => ai().discover(turns))
  handle('opencodeProbe', () => server().probe())
  handle('opencodeStart', () => server().start())
  handle('opencodeDisconnect', () => server().disconnect())
  const shells = () => { if (!terminals) throw new Error('Not ready'); return terminals }
  handle('terminalOpen', async input => {
    const folder = await files.inspect(input?.cwd || homedir())
    return shells().open({ ...input, cwd: folder.kind === 'folder' ? folder.path : dirname(folder.path) })
  })
  handle('terminalInput', (id, data) => shells().input(id, data))
  handle('terminalResize', (id, cols, rows) => shells().resize(id, cols, rows))
  handle('terminalClose', id => shells().close(id))
  handle('terminalFocus', focused => { terminalFocused = focused === true })
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
  handle('proposeConnector', input => recipes().propose(input))
  handle('searchConnectors', (query, id) => recipes().search(query, id))
  handle('planConnectorSearch', query => recipes().planSearch(query))
  handle('readRecipe', (ref, cursor) => recipes().read(ref, cursor))
  handle('recipeAction', (ref, operation, draft) => recipes().action(ref, operation, draft))
  handle('inspectPath', path => files.inspect(path))
  handle('listFolder', path => files.list(path))
  handle('readTextFile', path => files.read(path))
  handle('services', () => integrations().list())
  handle('searchServices', query => integrations().search(query))
  handle('frontConversations', input => integrations().frontList(input))
  handle('frontConversation', input => integrations().frontDetail(input))
  handle('saveService', input => integrations().save(input))
  handle('validateService', id => integrations().validate(id))
  handle('disconnectService', id => integrations().disconnect(id))
  handle('removeService', id => integrations().remove(id))
  handle('bootstrap', () => server().bootstrap(homedir(), process.platform))
  handle('reconnect', settings => server().connect(settings))
  handle('sessions', query => server().sessions(query))
  handle('activeSessions', () => server().activeSessions())
  handle('session', id => server().session(id))
  handle('messages', (id, cursor) => server().messages(id, cursor))
  handle('catalog', directory => server().catalog(directory))
  handle('createSession', input => server().createSession(input))
  handle('prompt', input => server().prompt(input))
  handle('interrupt', id => server().interrupt(id))
  handle('renameSession', (id, title) => server().renameSession(id, title))
  handle('switchAgent', (id, agent) => server().switchAgent(id, agent))
  handle('switchModel', (id, model) => server().switchModel(id, model))
  handle('permissionReply', input => server().permissionReply(input))
  handle('formReply', input => server().formReply(input))
  handle('formCancel', input => server().formCancel(input))
  handle('diff', input => server().diff(input))
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
  window = new BrowserWindow({
    title: 'ChatOS', width: 1440, height: 940, minWidth: 950, minHeight: 620,
    backgroundColor: '#f4f4f2', show: false,
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
  const store = storage
  // OpenCode is a source only once added; the setting survives restarts.
  bridge = new OpenCodeBridge(emit, process.env.CHATOS_DIRECTORY || process.cwd(), {
    url: process.env.CHATOS_SERVER_URL, token: process.env.CHATOS_SERVER_TOKEN,
  }, {
    load: () => {
      const raw = store.get('opencode-source')
      if (!raw) return undefined
      const saved = JSON.parse(raw) as { url?: string }
      const secret = store.secret('opencode:token')
      let token: string | undefined
      if (secret && secrets.available()) { try { token = secrets.decrypt(secret) } catch { /* Locked keychain: reconnect without the token. */ } }
      return { ...(typeof saved.url === 'string' && { url: saved.url }), ...(token && { token }) }
    },
    save: settings => {
      if (!settings) { store.saveSecret('opencode:token'); store.delete('opencode-source'); return }
      store.saveSecret('opencode:token', settings.token && secrets.available() ? secrets.encrypt(settings.token) : undefined)
      store.set('opencode-source', JSON.stringify({ ...(settings.url && { url: settings.url }) }))
    },
  })
  browsers = new Browsers(window, emit)
  terminals = new Terminals(emit)
  services ||= new Services(app.getPath('userData'), secrets, fetch, storage)
  const confirm = async (title: string, detail: string) => {
    if (!window) return false
    return (await dialog.showMessageBox(window, { type: 'question', title, message: title, detail, buttons: ['Cancel', 'Approve'], defaultId: 0, cancelId: 0, noLink: true })).response === 1
  }
  // K can also use a model your OpenCode service is signed into, e.g. a ChatGPT subscription.
  model ||= new ModelBroker(storage, secrets, confirm, undefined, undefined, {
    connected: () => Boolean(bridge?.connection.connected),
    generate: (prompt, ref) => { if (!bridge) throw new Error('OpenCode is not connected'); return bridge.generateText(prompt, ref) },
  })
  connectors ||= new Connectors(storage, secrets, confirm, prompt => model!.generate(prompt), undefined, undefined, url => shell.openExternal(url))
  registerIPC()
  files.warm(homedir())
  window.on('ready-to-show', () => window?.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('before-input-event', (event, input) => {
    const action = shortcutFor(input)
    const system = input.meta || (input.control && input.alt)
    if (action && terminalFocused && !system && action !== 'attach-selection') return
    if (action) { event.preventDefault(); emit({ type: 'shortcut', action }) }
  })
  window.on('closed', () => {
    connectors?.dispose()
    bridge?.dispose()
    browsers?.dispose()
    terminals?.dispose()
    window = undefined; bridge = undefined; browsers = undefined; terminals = undefined
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
