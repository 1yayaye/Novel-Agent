/// <reference types="vite/client" />

import type { NovelAgentApi } from '../shared/project'

declare global {
  interface Window {
    novelAgent: NovelAgentApi
  }
}

export {}
