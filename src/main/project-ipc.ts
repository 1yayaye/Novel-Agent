import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import {
  createServiceRouter,
  type ServiceRouter,
  type ServiceRouterDependencies
} from './service-router.js'
import type { ProjectStore } from './project-store.js'
import type { ConnectionStore } from './connection-store.js'
import type { ModelGateway } from './model-gateway.js'
import type { DiagnosticsService } from './diagnostics.js'
import type { AnalysisRunner } from './analysis-runner.js'
import type { CreationRunner } from './creation-runner.js'
import type { CandidateService } from './candidate-service.js'
import type { ChatService } from './chat-service.js'
import type { SearchIndex } from './search-index.js'

export {
  copySourceToNovels,
  createServiceRouter,
  type ServiceRouter,
  type ServiceRouterDependencies,
  type WindowDelegate
} from './service-router.js'

function isTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): boolean {
  return event.sender === window.webContents && event.senderFrame === event.sender.mainFrame
}

export function registerProjectIpc(
  window: BrowserWindow,
  store: ProjectStore,
  connectionStore?: ConnectionStore,
  modelGateway?: ModelGateway,
  diagnostics?: DiagnosticsService,
  analysisRunner?: AnalysisRunner,
  creationRunner?: CreationRunner,
  candidateService?: CandidateService,
  chatService?: ChatService,
  searchIndexInstance?: SearchIndex
): ServiceRouter {
  const serviceRouter = createServiceRouter({
    store,
    connectionStore,
    modelGateway,
    diagnostics,
    analysisRunner,
    creationRunner,
    candidateService,
    chatService,
    searchIndexInstance,
    windowDelegate: {
      minimize: () => {
        window.minimize()
        return true
      },
      toggleMaximize: () => {
        if (window.isMaximized()) {
          window.unmaximize()
        } else {
          window.maximize()
        }
        return window.isMaximized()
      },
      close: () => {
        window.close()
        return true
      },
      isMaximized: () => window.isMaximized(),
      showOpenDialog: (opts) => dialog.showOpenDialog(window, opts as any),
      showSaveDialog: (opts) => dialog.showSaveDialog(window, opts),
      openPath: (p) => shell.openPath(p)
    }
  })

  serviceRouter.onEvent((event) => {
    if (!window.isDestroyed()) {
      window.webContents.send(event.channel, event.payload)
    }
  })

  window.on('maximize', () => {
    serviceRouter.emitEvent('window:maximized', true)
  })
  window.on('unmaximize', () => {
    serviceRouter.emitEvent('window:maximized', false)
  })

  for (const channel of serviceRouter.getChannels()) {
    ipcMain.handle(channel, async (event, value) => {
      if (!isTrustedSender(event, window)) {
        return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: '不受信任的 IPC 调用来源' } }
      }
      return serviceRouter.handle(channel, value)
    })
  }

  return serviceRouter
}
