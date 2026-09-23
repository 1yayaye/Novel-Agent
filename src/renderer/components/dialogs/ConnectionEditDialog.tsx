import { useState, useEffect } from 'react'
import { Activity, Check, RefreshCw } from 'lucide-react'
import { ModelConnectionKind, ModelConnectionSummary, RemoteModelSummary } from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { getEndpointHost, computeSha256Fingerprint } from '../../utils/crypto'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { Input } from '@appica/ui-react/input'
import { Checkbox } from '@appica/ui-react/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@appica/ui-react/select'

export function ConnectionEditDialog({
  connection,
  initialKind = 'generation',
  onClose,
  onSaved
}: {
  connection: ModelConnectionSummary | null
  initialKind?: ModelConnectionKind
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = Boolean(connection)
  const [name, setName] = useState(connection?.name || '')
  const [kind, setKind] = useState<ModelConnectionKind>(connection?.kind || initialKind)
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl || 'https://api.siliconflow.cn/v1')
  const [isLocalService, setIsLocalService] = useState(connection?.isLocalService || false)
  const [model, setModel] = useState(connection?.model || '')
  const [apiKey, setApiKey] = useState('')
  const [contextWindow, setContextWindow] = useState(connection?.contextWindow || 128000)
  const [maxOutputTokens, setMaxOutputTokens] = useState(connection?.maxOutputTokens || 4096)
  const [safetyMarginRatio, setSafetyMarginRatio] = useState(connection?.safetyMarginRatio || 0.1)
  const [tokenEstimationRatio, setTokenEstimationRatio] = useState(connection?.tokenEstimationRatio || 1.5)
  const [batchSize, setBatchSize] = useState(connection?.batchSize || 16)
  const [streaming, setStreaming] = useState(connection?.capabilities?.streaming ?? true)
  const [jsonSchema, setJsonSchema] = useState(connection?.capabilities?.jsonSchema ?? true)
  const [temperature, setTemperature] = useState(connection?.capabilities?.temperature ?? true)
  const [usage, setUsage] = useState(connection?.capabilities?.usage ?? true)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; latencyMs?: number; message?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<RemoteModelSummary[]>([])
  const [modelFetchNotice, setModelFetchNotice] = useState<{ isError: boolean; message: string } | null>(null)

  const endpointPreview = getEndpointHost(baseUrl)

  useEffect(() => {
    void computeSha256Fingerprint(baseUrl, model).then(setFingerprint)
  }, [baseUrl, model])

  const handleFetchModels = async () => {
    if (!baseUrl.trim()) {
      setModelFetchNotice({ isError: true, message: '请先填写 Base URL' })
      return
    }
    setFetchingModels(true)
    setModelFetchNotice(null)
    setError('')
    try {
      const res = await window.novelAgent.connection.listModels({
        connectionId: connection?.id,
        draft: {
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || undefined,
          isLocalService
        }
      })
      setFetchedModels(res.models)
      if (res.models.length === 0) {
        setModelFetchNotice({ isError: false, message: '端点连接成功，但返回的模型列表为空' })
      } else {
        setModelFetchNotice({ isError: false, message: `已成功获取 ${res.models.length} 个可用模型` })
        if (!model.trim() && res.models[0]) {
          setModel(res.models[0].id)
        }
      }
    } catch (err) {
      setModelFetchNotice({ isError: true, message: errorText(err, '获取模型列表失败') })
    } finally {
      setFetchingModels(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    setError('')
    try {
      const res = await window.novelAgent.connection.test({
        draft: {
          name: name || '测试连接',
          kind,
          baseUrl,
          model,
          apiKey: apiKey || undefined,
          isLocalService
        }
      })
      setTestResult(res)
    } catch (err) {
      setTestResult({ success: false, message: errorText(err, '连接测试失败') })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim() || !model.trim()) {
      setError('请填写完整的连接名称、Base URL 与模型 ID')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (isEditing && connection) {
        await window.novelAgent.connection.update({
          connectionId: connection.id,
          expectedVersion: connection.version,
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiKey: apiKey.trim() || undefined,
          isLocalService,
          contextWindow,
          maxOutputTokens,
          safetyMarginRatio,
          tokenEstimationRatio,
          batchSize,
          capabilities: { streaming, jsonSchema, temperature, usage }
        })
      } else {
        await window.novelAgent.connection.create({
          name: name.trim(),
          kind,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          apiKey: apiKey.trim() || undefined,
          isLocalService,
          contextWindow,
          maxOutputTokens,
          safetyMarginRatio,
          tokenEstimationRatio,
          batchSize,
          capabilities: { streaming, jsonSchema, temperature, usage }
        })
      }
      onSaved()
    } catch (err) {
      setError(errorText(err, '保存模型连接失败'))
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex flex-col max-h-[90vh] sm:max-w-4xl" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>{isEditing ? '编辑模型连接' : '新建模型连接'}</DialogTitle>
          <DialogDescription>
            配置 OpenAI Chat Completions 或 Embeddings 兼容服务端点
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[480px] pr-2">
          <div className="flex flex-col gap-4 p-1">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 flex flex-col gap-1 text-xs">
                <label className="font-semibold text-[#7d6b59]">连接名称</label>
                <Input
                  autoFocus
                  className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：硅基流动 Qwen-2.5-72B"
                />
              </div>
              <div className="flex flex-col gap-1 text-xs">
                <label className="font-semibold text-[#7d6b59]">连接类型</label>
                <Select
                  value={kind}
                  disabled={isEditing}
                  onValueChange={(val) => setKind(val as ModelConnectionKind)}
                >
                  <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none disabled:bg-[#f5efe6]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generation">生成模型 (LLM)</SelectItem>
                    <SelectItem value="embedding">向量模型 (Embedding)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-[#7d6b59]">Base URL</label>
                <label className="flex items-center gap-1.5 cursor-pointer text-[#7d6b59]">
                  <Checkbox
                    checked={isLocalService}
                    onCheckedChange={(checked) => setIsLocalService(Boolean(checked))}
                  />
                  <span>允许本地 HTTP (localhost / 127.0.0.1)</span>
                </label>
              </div>
              <Input
                className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="例如：https://api.siliconflow.cn/v1"
              />
              <span className="text-[11px] text-[#9c8874]">
                结尾若含 /v1 将自动追加 /chat/completions 或 /embeddings
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1 text-xs">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-[#7d6b59]">模型 ID (Model ID)</label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs text-[#2d6a4f]"
                    disabled={fetchingModels || !baseUrl.trim()}
                    onClick={() => void handleFetchModels()}
                  >
                    <RefreshCw size={12} className={fetchingModels ? 'animate-spin' : ''} />
                    <span>{fetchingModels ? '获取中...' : '获取模型列表'}</span>
                  </Button>
                </div>
                <Input
                  list="remote-models-datalist"
                  className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="例如：Qwen/Qwen2.5-72B-Instruct"
                />
                <datalist id="remote-models-datalist">
                  {fetchedModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id} {m.ownedBy ? `(${m.ownedBy})` : ''}
                    </option>
                  ))}
                </datalist>
                {fetchedModels.length > 0 && (
                  <Select
                    value={fetchedModels.some((m) => m.id === model) ? model : 'placeholder'}
                    onValueChange={(val) => {
                      if (val && val !== 'placeholder') setModel(val as string)
                    }}
                  >
                    <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white p-1.5 text-xs text-[#2c2523]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="placeholder" disabled>
                        -- 快速从已获取列表中选择 ({fetchedModels.length} 个) --
                      </SelectItem>
                      {fetchedModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.id} {m.ownedBy ? `(${m.ownedBy})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {modelFetchNotice && (
                  <span
                    className={`text-[11px] ${
                      modelFetchNotice.isError ? 'text-red-600' : 'text-[#2d6a4f]'
                    }`}
                  >
                    {modelFetchNotice.message}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1 text-xs">
                <label className="font-semibold text-[#7d6b59]">
                  API Key {connection?.hasSecret && '(已安全加密，留空则保持不变)'}
                </label>
                <Input
                  type="password"
                  className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={connection?.hasSecret ? '••••••••••••••••' : 'sk-...'}
                />
              </div>
            </div>

            <Card className="flex items-center justify-between p-2.5 bg-[#f5efe6] border-[#e5ddd3] text-xs">
              <span className="text-[#7d6b59]">
                目标主机: <strong className="text-[#2c2523]">{endpointPreview}</strong>
              </span>
              <span className="text-[#7d6b59]">
                指纹: <code className="font-mono text-[11px] text-[#54473b]">{fingerprint}</code>
              </span>
            </Card>

            {kind === 'generation' ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1 text-xs">
                    <label className="font-semibold text-[#7d6b59]">Context Window</label>
                    <Input
                      type="number"
                      className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none"
                      value={contextWindow}
                      onChange={(e) => setContextWindow(Number(e.target.value) || 128000)}
                    />
                  </div>
                  <div className="flex flex-col gap-1 text-xs">
                    <label className="font-semibold text-[#7d6b59]">Max Output Tokens</label>
                    <Input
                      type="number"
                      className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none"
                      value={maxOutputTokens}
                      onChange={(e) => setMaxOutputTokens(Number(e.target.value) || 4096)}
                    />
                  </div>
                  <div className="flex flex-col gap-1 text-xs">
                    <label className="font-semibold text-[#7d6b59]">安全余量比例</label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      max="0.5"
                      className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none"
                      value={safetyMarginRatio}
                      onChange={(e) => setSafetyMarginRatio(Number(e.target.value) || 0.1)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 text-xs">
                  <label className="font-semibold text-[#7d6b59]">特性能力支持</label>
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#e5ddd3] bg-white p-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={streaming}
                        onCheckedChange={(checked) => setStreaming(Boolean(checked))}
                      />
                      <span>SSE 流式传输 (Streaming)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={jsonSchema}
                        onCheckedChange={(checked) => setJsonSchema(Boolean(checked))}
                      />
                      <span>结构化 JSON Schema</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={temperature}
                        onCheckedChange={(checked) => setTemperature(Boolean(checked))}
                      />
                      <span>创意度参数 (Temperature)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={usage}
                        onCheckedChange={(checked) => setUsage(Boolean(checked))}
                      />
                      <span>Token 用量统计 (Usage)</span>
                    </label>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1 text-xs">
                <label className="font-semibold text-[#7d6b59]">批处理大小 (Batch Size)</label>
                <Input
                  type="number"
                  className="rounded-lg border border-[#dacdbe] bg-white px-3 py-2 text-sm text-[#2c2523] outline-none max-w-xs"
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value) || 16)}
                />
              </div>
            )}

            {testResult && (
              <div
                className={`alert-banner ${testResult.success ? 'success' : 'danger'}`}
                style={{ padding: '8px 12px' }}
              >
                {testResult.success ? (
                  <span>✓ 连接测试成功！延迟: <strong>{testResult.latencyMs} ms</strong></span>
                ) : (
                  <span>✗ 测试失败: {testResult.message}</span>
                )}
              </div>
            )}

            {error && <p className="inline-error text-xs text-red-600">{error}</p>}
          </div>
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3">
          <Button
            type="button"
            variant="outline"
            disabled={testing}
            onClick={() => void handleTest()}
          >
            <Activity size={14} className={testing ? 'animate-spin' : ''} />
            {testing ? '测试中...' : '测试连通性'}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              type="button"
              disabled={saving || !name.trim() || !baseUrl.trim() || !model.trim()}
              onClick={() => void handleSave()}
            >
              <Check size={14} />
              {saving ? '保存中...' : '保存连接'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
