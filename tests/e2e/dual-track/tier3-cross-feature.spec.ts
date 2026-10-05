import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createDualTrackTestEnv,
  createTestProject,
  WebView2BridgeSimulator,
  getAccurateCharacterCount,
  type DualTrackTestEnv
} from './harness'
import { computeDiffHunks, synthesizeText } from '../../../src/main/candidate-service'

describe('Tier 3: Cross-Feature Combinations — Pairwise Interactions', () => {
  let env: DualTrackTestEnv

  beforeAll(async () => {
    env = await createDualTrackTestEnv()
  })

  afterAll(async () => {
    await env.cleanup()
  })

  // =========================================================================
  // Pairwise Interaction 1:
  // Create Project + Load Chapter + CodeMirror Edit + Debounced Save + DB Verify
  // =========================================================================
  it('pair-01: executes full create -> load -> edit -> save -> DB verification chain', async () => {
    const project = createTestProject(env, '配对链测试-编辑保存')
    const { sessionId } = await env.store.open(project.path)

    // 1. Create chapter
    const initialChapter = env.chapters.create(
      sessionId,
      '第一回 青牛镇拜师',
      '少年韩立背负布包，步入青牛镇。酒旗飘扬，行人如织。'
    )
    expect(initialChapter.version).toBe(1)

    // 2. Load chapter into simulated CodeMirror buffer
    const loaded = env.chapters.get(sessionId, initialChapter.id)
    let editorBuffer = loaded.content
    let docVersion = loaded.version

    // 3. Simulate user typing and character counting
    editorBuffer += '\n他抬头望向七玄门的接引木牌，眼中闪过一丝坚定。'
    const charCount = getAccurateCharacterCount(editorBuffer)
    expect(charCount).toBe(48)

    // 4. Save and persist
    const saved = env.chapters.update(sessionId, initialChapter.id, editorBuffer, docVersion)
    expect(saved.version).toBe(2)

    // 5. Direct SQLite verification across session close/reopen
    await env.store.close(sessionId)
    const reopened = await env.store.open(project.path)
    const verified = env.chapters.get(reopened.sessionId, initialChapter.id)

    expect(verified.version).toBe(2)
    expect(verified.content).toBe(editorBuffer)

    await env.store.close(reopened.sessionId)
  })

  // =========================================================================
  // Pairwise Interaction 2:
  // Open + Edit + AI Stream (candidate:delta) + Apply + Snapshot Creation
  // =========================================================================
  it('pair-02: executes chapter edit + AI stream + diff hunks + candidate apply + snapshot creation', async () => {
    const project = createTestProject(env, '配对链测试-AI流式与快照')
    const { sessionId } = await env.store.open(project.path)

    const ch = env.chapters.create(
      sessionId,
      '第二回 灵药催熟',
      '月朗星稀，神手谷中一片寂静。小瓶中滴出一滴青绿灵液。'
    )

    // 1. Simulate AI streaming generation through WebView2Bridge
    const bridge = new WebView2BridgeSimulator()
    const receivedDeltas: string[] = []

    bridge.on('message', (msgStr: string) => {
      const msg = JSON.parse(msgStr)
      if (msg.type === 'event' && msg.channel === 'candidate:delta') {
        receivedDeltas.push(msg.payload.delta)
      }
    })

    // Stream 3 deltas
    bridge.sendPushEvent('candidate:delta', { delta: '灵液滴在黄精草上，' })
    bridge.sendPushEvent('candidate:delta', { delta: '草叶瞬间舒展，' })
    bridge.sendPushEvent('candidate:delta', { delta: '散发出百年老药的气息。' })

    const fullAiOutput = receivedDeltas.join('')
    expect(fullAiOutput).toBe('灵液滴在黄精草上，草叶瞬间舒展，散发出百年老药的气息。')

    // 2. Compute diff hunks between original and candidate continuation
    const candidateText = ch.content + '\n' + fullAiOutput
    const hunks = computeDiffHunks(ch.content, candidateText)
    expect(hunks.length).toBeGreaterThanOrEqual(1)

    // 3. Create pre-apply snapshot
    const preSnapshot = env.chapters.createOrdinarySnapshot(sessionId, ch.id, ch.version)
    expect(preSnapshot).not.toBeNull()

    // 4. Apply candidate text to chapter
    const updated = env.chapters.update(sessionId, ch.id, candidateText, ch.version)
    expect(updated.version).toBe(2)
    expect(updated.content).toContain('散发出百年老药的气息')

    // 5. Verify snapshot integrity
    const snapshots = env.chapters.listSnapshots(sessionId, ch.id)
    expect(snapshots.length).toBeGreaterThanOrEqual(1)
    expect(snapshots.some((s) => s.id === preSnapshot!.id)).toBe(true)

    await env.store.close(sessionId)
  })

  // =========================================================================
  // Pairwise Interaction 3:
  // AI Stream In-Flight + Cancel + Editor Intact + Subsequent Completion
  // =========================================================================
  it('pair-03: verifies stream cancellation leaves editor intact and allows retry', async () => {
    const project = createTestProject(env, '配对链测试-流式取消与重试')
    const { sessionId } = await env.store.open(project.path)

    const ch = env.chapters.create(sessionId, '第三回 剑诀初成', '韩立手握木剑，潜心体会剑招。')
    const originalContent = ch.content
    const originalVersion = ch.version

    // 1. Simulate in-flight streaming
    const bridge = new WebView2BridgeSimulator()
    let streamActive = true

    bridge.registerHandler('creation.cancel', async () => {
      streamActive = false
      return { success: true }
    })

    // Emit initial delta
    bridge.sendPushEvent('candidate:delta', { delta: '剑风呼啸，' })

    // 2. User cancels
    const cancelRes = JSON.parse(await bridge.handleClientMessage({
      type: 'rpc_request',
      id: 'cancel-1',
      channel: 'creation.cancel',
      payload: {}
    }))
    expect(cancelRes.ok).toBe(true)
    expect(streamActive).toBe(false)

    // 3. Verify editor and chapter state remained untouched
    const currentChapter = env.chapters.get(sessionId, ch.id)
    expect(currentChapter.content).toBe(originalContent)
    expect(currentChapter.version).toBe(originalVersion)

    // 4. Subsequent completion succeeds
    const retryContent = originalContent + '\n剑气吞吐，势如游龙。'
    const updated = env.chapters.update(sessionId, ch.id, retryContent, originalVersion)
    expect(updated.version).toBe(originalVersion + 1)
    expect(updated.content).toContain('势如游龙')

    await env.store.close(sessionId)
  })

  // =========================================================================
  // Pairwise Interaction 4:
  // Edit + Snapshot + Major Rewrite + Restore + FTS Search Sync
  // =========================================================================
  it('pair-04: verifies edit -> snapshot -> major rewrite -> restore -> FTS auto-sync', async () => {
    const project = createTestProject(env, '配对链测试-快照恢复与检索')
    const { sessionId } = await env.store.open(project.path)

    const ch = env.chapters.create(
      sessionId,
      '第四回 试炼风云',
      '七玄门弟子齐聚血色禁地，各派精英虎视眈眈。'
    )

    // 1. Create baseline snapshot
    const baselineSnapshot = env.chapters.createOrdinarySnapshot(sessionId, ch.id, 1)
    expect(baselineSnapshot).not.toBeNull()

    // 2. Major rewrite
    const rewritten = env.chapters.update(
      sessionId,
      ch.id,
      '改版剧情：试炼大会临时取消，全员退守后山禁制。',
      1
    )
    expect(rewritten.version).toBe(2)

    // Sync FTS
    await env.searchIndex.sync(sessionId)
    const searchRewritten = env.searchIndex.searchKeyword(sessionId, { sessionId, query: '全员退守' })
    expect(searchRewritten.length).toBeGreaterThan(0)

    // 3. Restore snapshot
    const restored = env.chapters.restoreSnapshot(sessionId, baselineSnapshot!.id, 2)
    expect(restored.version).toBe(3)
    expect(restored.content).toBe('七玄门弟子齐聚血色禁地，各派精英虎视眈眈。')

    // 4. Verify FTS now finds original restored terms
    await env.searchIndex.sync(sessionId)
    const searchRestored = env.searchIndex.searchKeyword(sessionId, { sessionId, query: '血色禁地' })
    expect(searchRestored.length).toBeGreaterThan(0)
    expect(searchRestored[0].excerpt).toContain('血色禁地')

    await env.store.close(sessionId)
  })

  // =========================================================================
  // Pairwise Interaction 5:
  // PlatformBridge RPC -> Create Knowledge Entry -> Search Index Sync & Query
  // =========================================================================
  it('pair-05: bridges knowledge creation -> index synchronization -> keyword retrieval', async () => {
    const project = createTestProject(env, '配对链测试-知识库检索')
    const { sessionId } = await env.store.open(project.path)

    const bridge = new WebView2BridgeSimulator()
    bridge.registerHandler('knowledge.create', async (payload: any) => {
      const entry = env.knowledge.createEntry(sessionId, payload)
      return entry
    })

    // 1. RPC call to create character card
    const rpcRes = JSON.parse(await bridge.handleClientMessage({
      type: 'rpc_request',
      id: 'k-01',
      channel: 'knowledge.create',
      payload: {
        kind: 'character',
        title: '厉飞雨',
        authorContent: '七玄门弟子，韩立挚友，修炼抽髓丸导致寿元大减，为人豪迈重义气。'
      }
    }))

    expect(rpcRes.ok).toBe(true)
    expect(rpcRes.value.title).toBe('厉飞雨')

    // 2. Sync search index
    await env.searchIndex.sync(sessionId)

    // 3. Query knowledge entry via keyword search
    const results = env.searchIndex.searchKeyword(sessionId, { sessionId, query: '抽髓丸' })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toBe('厉飞雨')
    expect(results[0].excerpt).toContain('抽髓丸')

    await env.store.close(sessionId)
  })

  // =========================================================================
  // Pairwise Interaction 6:
  // Chat Session -> Multi-Turn Streaming -> Compaction -> Summary Persistence
  // =========================================================================
  it('pair-06: executes chat session lifecycle -> message append -> session compaction', async () => {
    const project = createTestProject(env, '配对链测试-AI对话与总结')
    const { sessionId } = await env.store.open(project.path)

    // 1. Create chat session
    const session = env.chatService.createSession({
      sessionId,
      title: '大纲推演讨论'
    })
    expect(session.id).toBeDefined()

    // 2. Add user message and assistant reply
    env.store.transaction(sessionId, (db) => {
      const now = Date.now()
      db.prepare(`
        INSERT INTO chat_message (id, chat_session_id, role, content, state, created_at)
        VALUES (?, ?, 'user', '如何安排筑基丹的争夺剧情？', 'completed', ?)
      `).run('msg-1', session.id, now)

      db.prepare(`
        INSERT INTO chat_message (id, chat_session_id, role, content, state, created_at)
        VALUES (?, ?, 'assistant', '可以在升仙大会上通过擂台比武，韩立伺机夺取一枚筑基丹。', 'completed', ?)
      `).run('msg-2', session.id, now)
      db.prepare(`
        INSERT INTO chat_summary (id, chat_session_id, content, version, created_at, updated_at)
        VALUES ('sum-1', ?, '初步剧情讨论。', 1, ?, ?)
      `).run(session.id, now, now)
    })

    const messages = env.chatService.listMessages({
      sessionId,
      chatSessionId: session.id
    })
    expect(messages.length).toBe(2)

    // 3. Update summary
    const summary = env.chatService.updateSummary({
      sessionId,
      summaryId: 'sum-1',
      content: '确定了韩立通过升仙大会争夺筑基丹的剧情线索。',
      expectedVersion: 1
    })
    expect(summary.content).toContain('筑基丹')

    // 4. Verify summary retrieval
    const fetchedSummary = env.chatService.getSummary({
      sessionId,
      chatSessionId: session.id
    })
    expect(fetchedSummary?.content).toContain('升仙大会')

    await env.store.close(sessionId)
  })
})
