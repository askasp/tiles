import { BrowserWindow, WebContentsView, session } from 'electron'
import type { BrowserPlacement, BrowserState, ChatOSAPI, DesktopEvent } from '../shared/types'
import { normalizeURL } from '../shared/util'
import { readShortcut } from './keys'

interface BrowserRecord {
  view: WebContentsView
  workspaceID: string
  url: string
  error?: string
}

export class Browsers {
  private tabs = new Map<string, BrowserRecord>()
  private partitions = new Set<string>()

  constructor(private window: BrowserWindow, private emit: (event: DesktopEvent) => void) {}

  private get(id: string) {
    const record = this.tabs.get(id)
    if (!record || record.view.webContents.isDestroyed()) throw new Error('This browser tab is not open.')
    return record
  }

  private state(id: string): BrowserState {
    const record = this.get(id)
    const contents = record.view.webContents
    return {
      id, url: contents.getURL() || record.url, title: contents.getTitle() || 'Browser',
      loading: contents.isLoading(), canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(), error: record.error,
    }
  }

  private changed(id: string) {
    if (!this.tabs.has(id) || this.window.isDestroyed()) return
    this.emit({ type: 'browser', tab: this.state(id) })
  }

  private create(placement: BrowserPlacement) {
    // An authenticated browser profile belongs to the desktop, not a workspace.
    // Moving a tile retains its exact WebContents and cookies.
    const partition = 'persist:chatos-web'
    if (!this.partitions.has(partition)) {
      const storage = session.fromPartition(partition)
      storage.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      storage.setPermissionCheckHandler(() => false)
      this.partitions.add(partition)
    }
    const view = new WebContentsView({ webPreferences: {
      partition, nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
    } })
    const record: BrowserRecord = { view, workspaceID: placement.workspaceID, url: normalizeURL(placement.url) }
    this.tabs.set(placement.id, record)
    this.window.contentView.addChildView(view)
    view.setVisible(false)
    const contents = view.webContents
    contents.setWindowOpenHandler(({ url }) => {
      try { this.emit({ type: 'browser-popup', workspaceID: record.workspaceID, tileID: placement.id, url: normalizeURL(url) }) } catch { /* Reject non-web popups. */ }
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      try {
        const normalized = normalizeURL(url)
        if ([...this.tabs].some(([id, other]) => id !== placement.id && (other.view.webContents.getURL() || other.url) === normalized)) {
          event.preventDefault(); this.emit({ type: 'browser-popup', workspaceID: record.workspaceID, tileID: placement.id, url: normalized })
        }
      } catch { event.preventDefault() }
    })
    contents.on('will-redirect', (event, url) => { try { normalizeURL(url) } catch { event.preventDefault() } })
    contents.on('did-start-loading', () => { record.error = undefined; this.changed(placement.id) })
    contents.on('did-stop-loading', () => this.changed(placement.id))
    contents.on('did-navigate', () => this.changed(placement.id))
    contents.on('did-navigate-in-page', () => this.changed(placement.id))
    contents.on('page-title-updated', () => this.changed(placement.id))
    contents.on('focus', () => this.emit({ type: 'tile-focus', tileID: placement.id }))
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) { record.error = description; this.changed(placement.id) }
    })
    contents.on('before-input-event', (event, input) => {
      const { action, swallow } = readShortcut(input)
      if (swallow) event.preventDefault()
      // The address field lives in ChatOS: take the keyboard back from the page first.
      if (action === 'address') this.window.webContents.focus()
      if (action) { this.emit({ type: 'shortcut', action }); return }
      // A browser's own page keys: Alt+← / Alt+→ back and forward, Ctrl+R or F5 reload.
      if (input.type !== 'keyDown' || input.meta || input.shift) return
      const history = contents.navigationHistory
      if (input.alt && !input.control && input.key === 'ArrowLeft') { event.preventDefault(); if (history.canGoBack()) history.goBack() }
      else if (input.alt && !input.control && input.key === 'ArrowRight') { event.preventDefault(); if (history.canGoForward()) history.goForward() }
      else if ((input.control && !input.alt && input.key.toLowerCase() === 'r') || (!input.control && !input.alt && input.key === 'F5')) { event.preventDefault(); contents.reload() }
    })
    contents.on('render-process-gone', () => { record.error = 'The page stopped. Reload to reopen it.'; this.changed(placement.id) })
    void contents.loadURL(record.url).catch(() => { /* did-fail-load updates the UI. */ })
    return record
  }

  layout(placements: BrowserPlacement[]) {
    const ids = new Set(placements.map(p => p.id))
    for (const [id, record] of this.tabs) if (!ids.has(id)) {
      // A hidden page must not keep the keyboard: workspace keys (Cmd+1…) would never reach ChatOS.
      if (record.view.webContents.isFocused()) this.window.webContents.focus()
      record.view.setVisible(false)
    }
    const area = this.window.getContentBounds()
    for (const placement of placements.slice(0, 4)) {
      if (!placement.id || !placement.workspaceID) throw new Error('Invalid browser placement')
      const record = this.tabs.get(placement.id) || this.create(placement)
      record.workspaceID = placement.workspaceID
      const zoom = this.window.webContents.getZoomFactor()
      const { x: cssX, y: cssY, width: cssWidth, height: cssHeight } = placement.bounds
      const x = cssX * zoom, y = cssY * zoom, width = cssWidth * zoom, height = cssHeight * zoom
      if (![x, y, width, height].every(Number.isFinite)) throw new Error('Invalid browser bounds')
      const left = Math.max(0, Math.round(x)), top = Math.max(0, Math.round(y))
      record.view.setBounds({
        x: left, y: top,
        width: Math.max(0, Math.min(Math.round(width), area.width - left)),
        height: Math.max(0, Math.min(Math.round(height), area.height - top)),
      })
      record.view.setVisible(width > 0 && height > 0)
    }
  }

  async action(input: Parameters<ChatOSAPI['browserAction']>[0]) {
    const record = this.get(input.id)
    const contents = record.view.webContents
    if (input.action === 'navigate') {
      record.url = normalizeURL(input.url || '')
      await contents.loadURL(record.url).catch(() => {})
    } else if (input.action === 'reload') contents.reload()
    else if (input.action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    else if (input.action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    else if (input.action === 'focus') contents.focus()
    else if (input.action === 'devtools') contents.openDevTools({ mode: 'detach' })
  }

  async context(id: string, selection = false) {
    const contents = this.get(id).view.webContents
    const text = await contents.executeJavaScript(selection
      ? "(() => { const e = document.activeElement; if (e?.tagName === 'INPUT' && e.type === 'password') return ''; const selected = window.getSelection()?.toString(); if (selected) return selected.slice(0, 12000); if (['TEXTAREA','INPUT'].includes(e?.tagName) && typeof e.selectionStart === 'number') return e.value.slice(e.selectionStart, e.selectionEnd).slice(0,12000); return ''; })()"
      : "document.body?.innerText?.slice(0, 12000) || ''") as string
    return { url: contents.getURL(), title: contents.getTitle(), text }
  }

  async screenshot(id: string) { return (await this.get(id).view.webContents.capturePage()).toDataURL() }

  close(id: string) {
    const record = this.tabs.get(id)
    if (!record) return
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(record.view)
    if (!record.view.webContents.isDestroyed()) record.view.webContents.close()
    this.tabs.delete(id)
  }

  dispose() { for (const id of this.tabs.keys()) this.close(id) }
}
