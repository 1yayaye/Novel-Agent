import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConnectionStore } from '../src/main/connection-store'
import { ProjectError, ProjectStore } from '../src/main/project-store'

describe('Task Route persistence and resolution', () => {
  let tempDir: string
  let connStore: ConnectionStore
  let projStore: ProjectStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'novel-agent-route-test-'))
    connStore = new ConnectionStore(tempDir)
    projStore = new ProjectStore(tempDir, connStore)
  })

  afterEach(async () => {
    await projStore.closeAll()
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })

  it('persists task routes with optimistic locking and resolves against connection store', async () => {
    const projPath = join(tempDir, 'test-route.novelproj')
    projStore.create({
      destination: projPath,
      title: 'Route Test Book',
      description: 'Route Test Description'
    })

    const openRes = await projStore.open(projPath)
    const sessionId = openRes.sessionId

    // 1. Create a generation connection
    const conn = connStore.create({
      name: 'Creative Qwen',
      kind: 'generation',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-72B-Instruct'
    })

    // 2. Set task route for 'continue'
    const route = projStore.setTaskRoute(sessionId, 'continue', conn.id)
    expect(route).not.toBeNull()
    expect(route?.taskType).toBe('continue')
    expect(route?.connectionId).toBe(conn.id)
    expect(route?.version).toBe(1)
    expect(route?.resolution).toBe('resolved')

    // 3. Update task route with expectedVersion
    const updatedRoute = projStore.setTaskRoute(sessionId, 'continue', conn.id, 1)
    expect(updatedRoute?.version).toBe(2)

    // Version conflict
    expect(() => {
      projStore.setTaskRoute(sessionId, 'continue', conn.id, 1)
    }).toThrowError(ProjectError)

    // 4. Close and re-open project -> verifies route persisted and resolved
    projStore.close(sessionId)
    const reopened = await projStore.open(projPath)
    const continueRoute = reopened.taskRoutes.find((r) => r.taskType === 'continue')
    expect(continueRoute).toBeDefined()
    expect(continueRoute?.connectionId).toBe(conn.id)
    expect(continueRoute?.resolution).toBe('resolved')

    // 5. Delete connection -> reopen -> resolution should be 'unresolved'
    connStore.delete(conn.id, conn.version)
    projStore.close(reopened.sessionId)

    const reopenedAfterDelete = await projStore.open(projPath)
    const unresolvedRoute = reopenedAfterDelete.taskRoutes.find((r) => r.taskType === 'continue')
    expect(unresolvedRoute).toBeDefined()
    expect(unresolvedRoute?.resolution).toBe('unresolved')

    // 6. Clear route
    const cleared = projStore.setTaskRoute(reopenedAfterDelete.sessionId, 'continue', null, 2)
    expect(cleared).toBeNull()
  })
})
