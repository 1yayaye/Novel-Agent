import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ProjectErrorCodeSchema } from '../shared/contracts/system'
import type { LogStateResult, SuccessResult } from '../shared/project'

export interface TaskLogEvent {
  taskId?: string
  taskType: string
  durationMs: number
  statusCode?: number
  retryCount?: number
  inputTokens?: number
  outputTokens?: number
  error?: string
}

export class DiagnosticsService {
  private detailedLoggingEnabled = false
  private currentSessionId: string
  private sessionLogDir: string
  private baseLogsDir: string

  constructor(private readonly dataPath: string) {
    this.baseLogsDir = join(dataPath, 'logs')
    mkdirSync(this.baseLogsDir, { recursive: true })
    this.currentSessionId = `session-${Date.now()}-${randomUUID().slice(0, 6)}`
    this.sessionLogDir = join(this.baseLogsDir, this.currentSessionId)
    this.cleanLeftoverSessions()
  }

  getLogState(): LogStateResult {
    return {
      detailedLoggingEnabled: this.detailedLoggingEnabled,
      logDirectory: this.detailedLoggingEnabled ? this.sessionLogDir : this.baseLogsDir
    }
  }

  setDetailedLogging(enabled: boolean): LogStateResult {
    this.detailedLoggingEnabled = enabled
    if (enabled && !existsSync(this.sessionLogDir)) {
      mkdirSync(this.sessionLogDir, { recursive: true })
    }
    return this.getLogState()
  }

  clearDetailedLogs(): SuccessResult {
    try {
      if (existsSync(this.sessionLogDir)) {
        const files = readdirSync(this.sessionLogDir)
        for (const file of files) {
          try {
            unlinkSync(join(this.sessionLogDir, file))
          } catch {}
        }
      }
    } catch {}
    return { success: true }
  }

  logTaskEvent(event: TaskLogEvent): void {
    const stableError = event.error === undefined
      ? undefined
      : ProjectErrorCodeSchema.safeParse(event.error).success
      ? event.error
      : 'UNKNOWN_ERROR'

    const entry = {
      timestamp: Date.now(),
      taskId: event.taskId,
      taskType: event.taskType,
      durationMs: event.durationMs,
      statusCode: event.statusCode,
      retryCount: event.retryCount ?? 0,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      error: stableError
    }

    const logLine = `${JSON.stringify(entry)}\n`
    try {
      const generalLogPath = join(this.baseLogsDir, 'events.log')
      writeFileSync(generalLogPath, logLine, { flag: 'a', encoding: 'utf8' })
    } catch {}

    if (this.detailedLoggingEnabled) {
      try {
        mkdirSync(this.sessionLogDir, { recursive: true })
        const sessionLogPath = join(this.sessionLogDir, 'session-events.log')
        writeFileSync(sessionLogPath, logLine, { flag: 'a', encoding: 'utf8' })
      } catch {}
    }
  }

  logDetailedPayload(category: string, data: Record<string, unknown>): void {
    if (!this.detailedLoggingEnabled) return
    try {
      mkdirSync(this.sessionLogDir, { recursive: true })
      const filename = `${Date.now()}-${category}-${randomUUID().slice(0, 6)}.json`
      const targetPath = join(this.sessionLogDir, filename)
      writeFileSync(targetPath, JSON.stringify({ timestamp: Date.now(), category, ...data }, null, 2), 'utf8')
    } catch {}
  }

  redactHeaders(headers: Record<string, string>): Record<string, string> {
    const redacted: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase()
      if (lower.includes('auth') || lower.includes('key') || lower.includes('secret') || lower.includes('token')) {
        redacted[key] = '[REDACTED]'
      } else {
        redacted[key] = value
      }
    }
    return redacted
  }

  cleanUp(): void {
    try {
      if (existsSync(this.sessionLogDir)) {
        rmSync(this.sessionLogDir, { recursive: true, force: true })
      }
    } catch {}
  }

  private cleanLeftoverSessions(): void {
    try {
      if (!existsSync(this.baseLogsDir)) return
      const entries = readdirSync(this.baseLogsDir)
      for (const entry of entries) {
        if (entry.startsWith('session-') && entry !== this.currentSessionId) {
          const fullPath = join(this.baseLogsDir, entry)
          try {
            if (statSync(fullPath).isDirectory()) {
              rmSync(fullPath, { recursive: true, force: true })
            }
          } catch {}
        }
      }
    } catch {}
  }
}
