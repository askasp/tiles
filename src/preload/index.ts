import { contextBridge, ipcRenderer } from 'electron'
import type { ChatOSAPI, DesktopEvent } from '../shared/types'

const invoke = <K extends keyof ChatOSAPI>(name: K) =>
  (...args: Parameters<ChatOSAPI[K]>) => ipcRenderer.invoke(`chatos:${name}`, ...args)

const api: ChatOSAPI = {
  modelInfo: invoke('modelInfo'), saveModel: invoke('saveModel'), forgetModelKey: invoke('forgetModelKey'), discoverSource: invoke('discoverSource'),
  probeModel: invoke('probeModel'), skipModel: invoke('skipModel'),
  opencodeProbe: invoke('opencodeProbe'), opencodeStart: invoke('opencodeStart'), opencodeDisconnect: invoke('opencodeDisconnect'),
  terminalOpen: invoke('terminalOpen'), terminalInput: invoke('terminalInput'), terminalResize: invoke('terminalResize'), terminalClose: invoke('terminalClose'), terminalFocus: invoke('terminalFocus'),
  readImage: invoke('readImage'), findFolders: invoke('findFolders'),
  loadDesktop: legacy => { const result = ipcRenderer.sendSync('chatos:storage-load', legacy); if (result.error) throw new Error(result.error); return result.value },
  flushDesktop: raw => { const result = ipcRenderer.sendSync('chatos:storage-flush', raw); if (result.error) throw new Error(result.error) },
  saveDesktop: invoke('saveDesktop'), backupStorage: invoke('backupStorage'),
  connectors: invoke('connectors'), saveConnector: invoke('saveConnector'), connectorRevisions: invoke('connectorRevisions'),
  connectorToken: invoke('connectorToken'), connectorOAuth: invoke('connectorOAuth'), disconnectConnector: invoke('disconnectConnector'), proposeConnector: invoke('proposeConnector'),
  searchConnectors: invoke('searchConnectors'), planConnectorSearch: invoke('planConnectorSearch'), readRecipe: invoke('readRecipe'), recipeAction: invoke('recipeAction'),
  inspectPath: invoke('inspectPath'), listFolder: invoke('listFolder'), readTextFile: invoke('readTextFile'),
  services: invoke('services'), saveService: invoke('saveService'), validateService: invoke('validateService'), disconnectService: invoke('disconnectService'), removeService: invoke('removeService'),
  searchServices: invoke('searchServices'),
  frontConversations: invoke('frontConversations'), frontConversation: invoke('frontConversation'),
  bootstrap: invoke('bootstrap'), reconnect: invoke('reconnect'),
  sessions: invoke('sessions'), activeSessions: invoke('activeSessions'),
  session: invoke('session'), messages: invoke('messages'), catalog: invoke('catalog'),
  createSession: invoke('createSession'), prompt: invoke('prompt'), interrupt: invoke('interrupt'),
  renameSession: invoke('renameSession'), switchAgent: invoke('switchAgent'), switchModel: invoke('switchModel'),
  permissionReply: invoke('permissionReply'), formReply: invoke('formReply'), formCancel: invoke('formCancel'),
  diff: invoke('diff'), chooseFolder: invoke('chooseFolder'), chooseFiles: invoke('chooseFiles'),
  browserLayout: invoke('browserLayout'), browserAction: invoke('browserAction'), browserClose: invoke('browserClose'),
  browserContext: invoke('browserContext'), browserScreenshot: invoke('browserScreenshot'),
  onEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, event: DesktopEvent) => listener(event)
    ipcRenderer.on('chatos:event', handler)
    return () => { ipcRenderer.removeListener('chatos:event', handler) }
  },
}

contextBridge.exposeInMainWorld('chatos', api)
