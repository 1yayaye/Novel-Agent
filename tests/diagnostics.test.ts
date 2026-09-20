import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiagnosticsService } from '../src/main/diagnostics'

describe('DiagnosticsService', () => {
  let tempDir: string
  let service: DiagnosticsService

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-agent-diag-test-'))
    service = new DiagnosticsService(tempDir)
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('redacts sensitive headers containing auth, key, secret, or token', () => {
    const rawHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-1234567890',
      'X-API-Key': 'secret-token-value',
      'Custom-Token': 'auth-token',
      'X-Normal-Header': 'public-value'
    }

    const redacted = service.redactHeaders(rawHeaders)
    expect(redacted['Content-Type']).toBe('application/json')
    expect(redacted['Authorization']).toBe('[REDACTED]')
    expect(redacted['X-API-Key']).toBe('[REDACTED]')
    expect(redacted['Custom-Token']).toBe('[REDACTED]')
    expect(redacted['X-Normal-Header']).toBe('public-value')
  })

  it('logs standard summary events to events.log without logging text payload', () => {
    service.logTaskEvent({
      taskId: 'task-123',
      taskType: 'continue',
      durationMs: 450,
      statusCode: 200,
      inputTokens: 120,
      outputTokens: 80,
      error: 'AUDIT_SECRET_MARKER'
    })

    const eventsLogPath = join(tempDir, 'logs', 'events.log')
    expect(existsSync(eventsLogPath)).toBe(true)

    const content = readFileSync(eventsLogPath, 'utf8')
    expect(content).toContain('"taskType":"continue"')
    expect(content).toContain('"durationMs":450')
    expect(content).toContain('"inputTokens":120')
    expect(content).not.toContain('AUDIT_SECRET_MARKER')
    expect(content).toContain('"error":"UNKNOWN_ERROR"')
  })

  it('writes detailed content payloads only when detailed logging is enabled', () => {
    const stateBefore = service.getLogState()
    expect(stateBefore.detailedLoggingEnabled).toBe(false)

    // Log payload when disabled
    service.logDetailedPayload('chat_request', { prompt: 'Secret novel paragraph' })
    expect(readdirSync(stateBefore.logDirectory).filter((f) => f.endsWith('.json')).length).toBe(0)

    // Enable detailed logging
    const stateAfter = service.setDetailedLogging(true)
    expect(stateAfter.detailedLoggingEnabled).toBe(true)
    expect(existsSync(stateAfter.logDirectory)).toBe(true)

    service.logDetailedPayload('chat_request', { prompt: 'Detailed prompt for debugging' })
    const files = readdirSync(stateAfter.logDirectory).filter((f) => f.endsWith('.json'))
    expect(files.length).toBe(1)

    const content = readFileSync(join(stateAfter.logDirectory, files[0]), 'utf8')
    expect(content).toContain('Detailed prompt for debugging')

    // Clear detailed logs
    service.clearDetailedLogs()
    expect(readdirSync(stateAfter.logDirectory).filter((f) => f.endsWith('.json')).length).toBe(0)
  })

  it('cleans leftover sessions from previous crashes on startup', () => {
    const logsDir = join(tempDir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const leftoverDir = join(logsDir, 'session-old-crashed-123')
    mkdirSync(leftoverDir, { recursive: true })
    writeFileSync(join(leftoverDir, 'leftover.log'), 'test')

    expect(existsSync(leftoverDir)).toBe(true)

    // Create new service instance -> triggers cleanLeftoverSessions
    const newService = new DiagnosticsService(tempDir)
    expect(existsSync(leftoverDir)).toBe(false)

    // cleanUp removes current session
    newService.setDetailedLogging(true)
    const currentSessionDir = newService.getLogState().logDirectory
    expect(existsSync(currentSessionDir)).toBe(true)
    newService.cleanUp()
    expect(existsSync(currentSessionDir)).toBe(false)
  })
})
