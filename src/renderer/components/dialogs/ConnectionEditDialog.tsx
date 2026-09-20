import React, { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { Activity, Check, RefreshCw, X } from 'lucide-react'
import { ModelConnectionKind, ModelConnectionSummary, RemoteModelSummary } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { getEndpointHost, computeSha256Fingerprint } from '../../utils/crypto'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

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
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
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
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={dialogRef} className="conn-form-dialog" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2>{isEditing ? '编辑模型连接' : '新建模型连接'}</h2>
            <p>配置 OpenAI Chat Completions 或 Embeddings 兼容服务端点</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>
        <div className="conn-form-body">
          <div className="form-row">
            <div className="form-field" style={{ flex: 2 }}>
              <label>连接名称</label>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：硅基流动 Qwen-2.5-72B" />
            </div>
            <div className="form-field" style={{ flex: 1 }}>
              <label>连接类型</label>
              <select value={kind} disabled={isEditing} onChange={(e) => setKind(e.target.value as ModelConnectionKind)}>
                <option value="generation">生成模型 (LLM)</option>
                <option value="embedding">向量模型 (Embedding)</option>
              </select>
            </div>
          </div>

          <div className="form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label>Base URL</label>
              <label className="checkbox-field" style={{ margin: 0, fontSize: 12 }}>
                <input type="checkbox" checked={isLocalService} onChange={(e) => setIsLocalService(e.target.checked)} />
                <span>允许本地 HTTP (localhost / 127.0.0.1)</span>
              </label>
            </div>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="例如：https://api.siliconflow.cn/v1" />
            <span className="field-help">结尾若含 /v1 将自动追加 /chat/completions 或 /embeddings</span>
          </div>

          <div className="form-row">
            <div className="form-field" style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label>模型 ID (Model ID)</label>
                <button
                  type="button"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    color: '#2d5a27',
                    background: 'none',
                    border: 'none',
                    cursor: fetchingModels || !baseUrl.trim() ? 'not-allowed' : 'pointer',
                    opacity: fetchingModels || !baseUrl.trim() ? 0.6 : 1,
                    padding: 0
                  }}
                  disabled={fetchingModels || !baseUrl.trim()}
                  onClick={() => void handleFetchModels()}
                  title="向服务商查询当前 API Key / 端点支持的模型列表"
                >
                  <RefreshCw size={12} className={fetchingModels ? 'spin-icon' : ''} />
                  <span>{fetchingModels ? '获取中...' : '获取模型列表'}</span>
                </button>
              </div>
              <input
                list="remote-models-datalist"
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
                <select
                  value={fetchedModels.some((m) => m.id === model) ? model : ''}
                  onChange={(e) => {
                    if (e.target.value) setModel(e.target.value)
                  }}
                  style={{ marginTop: 4, fontSize: 12 }}
                >
                  <option value="" disabled>-- 快速从已获取列表中选择 ({fetchedModels.length} 个) --</option>
                  {fetchedModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} {m.ownedBy ? `(${m.ownedBy})` : ''}
                    </option>
                  ))}
                </select>
              )}
              {modelFetchNotice && (
                <span
                  className="field-help"
                  style={{
                    color: modelFetchNotice.isError ? '#8b322c' : '#2d5a27',
                    fontWeight: 500
                  }}
                >
                  {modelFetchNotice.message}
                </span>
              )}
            </div>
            <div className="form-field" style={{ flex: 1 }}>
              <label>API Key {connection?.hasSecret && '(已安全加密，留空则保持不变)'}</label>
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={connection?.hasSecret ? '••••••••••••••••' : 'sk-...'} />
            </div>
          </div>

          <div className="target-preview-box">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>目标主机: <strong>{endpointPreview}</strong></span>
              <span>指纹: <code>{fingerprint}</code></span>
            </div>
          </div>

          {kind === 'generation' ? (
            <>
              <div className="form-row">
                <div className="form-field">
                  <label>Context Window</label>
                  <input type="number" value={contextWindow} onChange={(e) => setContextWindow(Number(e.target.value) || 128000)} />
                </div>
                <div className="form-field">
                  <label>Max Output Tokens</label>
                  <input type="number" value={maxOutputTokens} onChange={(e) => setMaxOutputTokens(Number(e.target.value) || 4096)} />
                </div>
                <div className="form-field">
                  <label>安全余量比例</label>
                  <input type="number" step="0.05" min="0" max="0.5" value={safetyMarginRatio} onChange={(e) => setSafetyMarginRatio(Number(e.target.value) || 0.1)} />
                </div>
              </div>
              <div className="form-field">
                <label>特性能力支持</label>
                <div className="capabilities-grid">
                  <label className="checkbox-field"><input type="checkbox" checked={streaming} onChange={(e) => setStreaming(e.target.checked)} /><span>SSE 流式传输 (Streaming)</span></label>
                  <label className="checkbox-field"><input type="checkbox" checked={jsonSchema} onChange={(e) => setJsonSchema(e.target.checked)} /><span>结构化 JSON Schema</span></label>
                  <label className="checkbox-field"><input type="checkbox" checked={temperature} onChange={(e) => setTemperature(e.target.checked)} /><span>创意度参数 (Temperature)</span></label>
                  <label className="checkbox-field"><input type="checkbox" checked={usage} onChange={(e) => setUsage(e.target.checked)} /><span>Token 用量统计 (Usage)</span></label>
                </div>
              </div>
            </>
          ) : (
            <div className="form-row">
              <div className="form-field">
                <label>批处理大小 (Batch Size)</label>
                <input type="number" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value) || 16)} />
              </div>
            </div>
          )}

          {testResult && (
            <div className={`alert-banner ${testResult.success ? 'success' : 'danger'}`} style={{ padding: '8px 12px' }}>
              {testResult.success ? (
                <span>✓ 连接测试成功！延迟: <strong>{testResult.latencyMs} ms</strong></span>
              ) : (
                <span>✗ 测试失败: {testResult.message}</span>
              )}
            </div>
          )}

          {error && <p className="inline-error">{error}</p>}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="text-button" disabled={testing} onClick={() => void handleTest()}>
            <Activity size={14} />{testing ? '测试中...' : '测试连通性'}
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="text-button" onClick={onClose}>取消</button>
            <button type="button" className="primary-button" disabled={saving || !name.trim() || !baseUrl.trim() || !model.trim()} onClick={() => void handleSave()}>
              <Check size={14} />{saving ? '保存中...' : '保存连接'}
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  )
}
