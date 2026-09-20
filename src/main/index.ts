import { app, BrowserWindow, dialog, Menu, net, protocol } from 'electron'
import { existsSync } from 'node:fs'
import { join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureWritableDirectory, dataDirectory } from './paths'
import { runNativeProbe, writeProbeResult } from './native-probe'
import { rendererUrl } from './runtime'
import { ProjectStore } from './project-store'
import { registerProjectIpc } from './project-ipc'
import { ConnectionStore } from './connection-store'
import { ModelGateway } from './model-gateway'
import { DiagnosticsService } from './diagnostics'
import { SearchIndex } from './search-index'
import { AnalysisRunner } from './analysis-runner'
import { ContextAssembler } from './context-assembler'
import { CandidateService } from './candidate-service'
import { CreationRunner } from './creation-runner'
import { ChatService } from './chat-service'

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const dataPath = dataDirectory(process.execPath, app.isPackaged)
const probeArgument = process.argv.find((argument) => argument.startsWith('--native-probe-output='))
const probeOutput = app.commandLine.getSwitchValue('native-probe-output') || probeArgument?.slice('--native-probe-output='.length) || ''
let projectStore: ProjectStore | undefined
let connectionStore: ConnectionStore | undefined
let modelGateway: ModelGateway | undefined
let diagnosticsService: DiagnosticsService | undefined
let searchIndex: SearchIndex | undefined
let analysisRunner: AnalysisRunner | undefined
let candidateService: CandidateService | undefined
let creationRunner: CreationRunner | undefined
let chatService: ChatService | undefined
let dataPathError: unknown
try {
  app.setPath('userData', dataPath)
  app.setPath('logs', join(dataPath, 'logs'))
  ensureWritableDirectory(dataPath)
} catch (error) {
  dataPathError = error
}

function registerAppProtocol(): void {
  const rendererDirectory = join(__dirname, '../renderer')
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname
    const filePath = resolve(rendererDirectory, `.${decodeURIComponent(pathname)}`)
    if (url.host !== 'novel-agent' || !filePath.startsWith(`${normalize(rendererDirectory)}${sep}`) || !existsSync(filePath)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString()).then((response) => {
      const headers = new Headers(response.headers)
      headers.set('Content-Security-Policy', contentSecurityPolicy(false))
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    })
  })
}

function contentSecurityPolicy(isDevelopment: boolean): string {
  const hmr = isDevelopment ? " 'unsafe-inline' http://localhost:5173" : ''
  const connect = isDevelopment ? " 'self' http://localhost:5173 ws://localhost:5173" : " 'self'"
  return `default-src 'self'; script-src 'self'${hmr}; style-src 'self'${hmr}; connect-src${connect}; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'`
}

function createWindow(
  store: ProjectStore,
  connections: ConnectionStore,
  gateway: ModelGateway,
  diagnostics: DiagnosticsService,
  runner?: AnalysisRunner,
  creation?: CreationRunner,
  candidate?: CandidateService,
  chat?: ChatService,
  searchIndexInstance?: SearchIndex
): BrowserWindow {
  Menu.setApplicationMenu(null)
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false
    }
  })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://novel-agent/')) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  registerProjectIpc(window, store, connections, gateway, diagnostics, runner, creation, candidate, chat, searchIndexInstance)
  const devServerUrl = rendererUrl(app.isPackaged, process.env.ELECTRON_RENDERER_URL)
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy(Boolean(devServerUrl))] } }))
  if (devServerUrl) window.loadURL(devServerUrl)
  else window.loadURL('app://novel-agent/index.html')
  return window
}

async function start(): Promise<void> {
  if (dataPathError) {
    await dialog.showMessageBox({ type: 'error', title: 'Novel Agent 无法启动', message: `无法写入数据目录：${dataPath}`, detail: dataPathError instanceof Error ? dataPathError.message : String(dataPathError) })
    app.quit()
    return
  }
  registerAppProtocol()
  if (probeOutput) {
    writeProbeResult(probeOutput, await runNativeProbe(app.isPackaged))
    app.quit()
    return
  }
  diagnosticsService = new DiagnosticsService(dataPath)
  connectionStore = new ConnectionStore(dataPath)
  modelGateway = new ModelGateway(connectionStore, diagnosticsService)
  projectStore = new ProjectStore(dataPath, connectionStore)
  searchIndex = new SearchIndex(projectStore, modelGateway, connectionStore)
  analysisRunner = new AnalysisRunner(projectStore, modelGateway, connectionStore, searchIndex)
  const contextAssembler = new ContextAssembler(projectStore, searchIndex, connectionStore, modelGateway)
  candidateService = new CandidateService(projectStore, searchIndex)
  creationRunner = new CreationRunner(projectStore, modelGateway, connectionStore, contextAssembler, candidateService)
  chatService = new ChatService(projectStore, modelGateway, connectionStore, contextAssembler, searchIndex)
  createWindow(projectStore, connectionStore, modelGateway, diagnosticsService, analysisRunner, creationRunner, candidateService, chatService, searchIndex)
}

app.whenReady().then(start).catch(async (error) => {
  if (probeOutput) {
    console.error(error)
    app.quit()
    return
  }
  await dialog.showMessageBox({ type: 'error', title: 'Novel Agent 无法启动', message: error instanceof Error ? error.message : String(error) })
  app.quit()
})

app.on('before-quit', (event) => {
  diagnosticsService?.cleanUp()
  if (!projectStore) return
  event.preventDefault()
  const store = projectStore
  projectStore = undefined
  void store.closeAll().finally(() => app.quit())
})
app.on('window-all-closed', () => app.quit())
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
})
