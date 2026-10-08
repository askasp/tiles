import { contextBridge, ipcRenderer } from 'electron'
import type { ChatOSAPI, CoreAPI, DesktopEvent } from '../shared/types'
import { sourceMethods, type SourceAPIs } from '../shared/registry-api'

type Method = Exclude<keyof CoreAPI, 'onEvent' | 'loadDesktop' | 'flushDesktop'>
const invoke = <K extends Method>(name: K) =>
  (...args: Parameters<CoreAPI[K]>) => ipcRenderer.invoke(`chatos:${name}`, ...args)
// Each source's methods live under its own namespace: chatos.opencode.sessions(…)
const sourceAPIs = Object.fromEntries(Object.entries(sourceMethods).map(([id, methods]) => [id, Object.fromEntries((methods as readonly string[]).map(method => [method, (...args: unknown[]) => ipcRenderer.invoke(`chatos:${id}.${method}`, ...args)]))])) as unknown as SourceAPIs

const api: ChatOSAPI = {
  ...sourceAPIs,
  modelInfo: invoke('modelInfo'), saveModel: invoke('saveModel'), forgetModelKey: invoke('forgetModelKey'), discoverSource: invoke('discoverSource'),
  probeModel: invoke('probeModel'), skipModel: invoke('skipModel'),
  terminalOpen: invoke('terminalOpen'), terminalInput: invoke('terminalInput'), terminalResize: invoke('terminalResize'), terminalClose: invoke('terminalClose'), keyMode: invoke('keyMode'), environment: invoke('environment'), theme: invoke('theme'),
  readImage: invoke('readImage'), findPaths: invoke('findPaths'),
  loadDesktop: legacy => { const result = ipcRenderer.sendSync('chatos:storage-load', legacy); if (result.error) throw new Error(result.error); return result.value },
  flushDesktop: raw => { const result = ipcRenderer.sendSync('chatos:storage-flush', raw); if (result.error) throw new Error(result.error) },
  saveDesktop: invoke('saveDesktop'), backupStorage: invoke('backupStorage'),
  connectors: invoke('connectors'), saveConnector: invoke('saveConnector'), connectorRevisions: invoke('connectorRevisions'),
  connectorToken: invoke('connectorToken'), connectorOAuth: invoke('connectorOAuth'), disconnectConnector: invoke('disconnectConnector'), builtinConnector: invoke('builtinConnector'), addBuiltinConnector: invoke('addBuiltinConnector'), removeConnector: invoke('removeConnector'), connectorSettings: invoke('connectorSettings'), proposeConnector: invoke('proposeConnector'),
  searchConnectors: invoke('searchConnectors'), planConnectorSearch: invoke('planConnectorSearch'), readRecipe: invoke('readRecipe'), recipeAction: invoke('recipeAction'),
  inspectPath: invoke('inspectPath'), listFolder: invoke('listFolder'), readTextFile: invoke('readTextFile'), trashPath: invoke('trashPath'),
  chooseFolder: invoke('chooseFolder'), chooseFiles: invoke('chooseFiles'),
  browserLayout: invoke('browserLayout'), browserAction: invoke('browserAction'), browserClose: invoke('browserClose'),
  browserContext: invoke('browserContext'), browserScreenshot: invoke('browserScreenshot'),
  onEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, event: DesktopEvent) => listener(event)
    ipcRenderer.on('chatos:event', handler)
    return () => { ipcRenderer.removeListener('chatos:event', handler) }
  },
}

contextBridge.exposeInMainWorld('chatos', api)
