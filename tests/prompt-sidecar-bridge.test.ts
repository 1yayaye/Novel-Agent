import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import { describe, expect, it } from 'vitest'
import { startSidecar } from '../src/main/sidecar'
import { createNovelAgentApi } from '../src/shared/platform-bridge/api-factory'
import { WebView2Transport, type ChromeWebViewLike, type WebView2RpcRequest } from '../src/shared/platform-bridge/transport'
import { DEFAULT_PRESET_STORE, type PresetStoreData } from '../src/shared/prompt-settings'

describe('WebView2 creative settings through the real NDJSON sidecar', () => {
  it('saves without a project, survives restart and returns domain errors across the wire', async () => {
    const dataPath = mkdtempSync(join(tmpdir(), 'novel-prompt-webview-'))
    const connect = () => {
      const input = new PassThrough()
      const output = new PassThrough()
      const sidecar = startSidecar({ input, output, dataPath })
      const listeners = new Set<(event: { data: unknown }) => void>()
      const webview: ChromeWebViewLike = {
        postMessage(value) {
          const request = value as WebView2RpcRequest
          input.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, method: request.channel, params: request.payload })}\n`)
        },
        addEventListener(_type, listener) { listeners.add(listener) },
        removeEventListener(_type, listener) { listeners.delete(listener) }
      }
      const lines = createInterface({ input: output })
      lines.on('line', (line) => {
        const response = JSON.parse(line)
        if (!response.id) return
        const data = response.error
          ? { type: 'rpc_response', id: response.id, ok: false, error: { code: response.error.data?.domainCode ?? 'INTERNAL_ERROR', message: response.error.message } }
          : { type: 'rpc_response', id: response.id, ok: true, value: response.result }
        for (const listener of listeners) listener({ data })
      })
      const transport = new WebView2Transport(webview, { defaultTimeoutMs: 2000 })
      return { transport, api: createNovelAgentApi(transport), close: async () => { transport.dispose(); lines.close(); await sidecar.close() } }
    }
    let host = connect()
    try {
      expect((await host.api.prompt.getPresetStore()).store).toEqual(DEFAULT_PRESET_STORE)
      const storeData: PresetStoreData = {
        activePresetId: 'preset-sidecar',
        presets: [{
          id: 'preset-sidecar',
          name: '跨进程酒馆预设',
          blocks: [
            { id: 'b1', name: '系统块', role: 'system', content: '酒馆提示词', enabled: true, position: 'relative', depth: 0, order: 0 }
          ],
          createdAt: 100,
          updatedAt: 100
        }]
      }
      await host.api.prompt.savePresetStore(storeData)
      expect(JSON.parse(readFileSync(join(dataPath, 'prompt-presets.json'), 'utf8'))).toEqual(storeData)

      // 测试通过 RPC 解析酒馆预设文本
      const parsed = await host.api.prompt.parseTavernFile(JSON.stringify({
        name: '导入预设',
        prompts: [{ identifier: 'p1', name: '引导', content: 'You are {{char}}. Wait for {{user}} to respond.' }]
      }))
      expect(parsed.name).toBe('导入预设')
      expect(parsed.blocks.length).toBeGreaterThan(0)
      expect(parsed.blocks.some((b) => b.content.includes('叙述者'))).toBe(true)

      await expect(host.transport.invoke('prompt.savePresetStore', { activePresetId: 123 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      await expect(host.transport.invoke('prompt.getSettings')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
      await host.close()
      host = connect()
      expect((await host.api.prompt.getPresetStore()).store).toEqual(storeData)
    } finally {
      await host.close()
      if (!dataPath.startsWith(join(tmpdir(), 'novel-prompt-webview-'))) throw new Error('Unexpected fixture path')
      rmSync(dataPath, { recursive: true, force: true })
    }
  })
})
