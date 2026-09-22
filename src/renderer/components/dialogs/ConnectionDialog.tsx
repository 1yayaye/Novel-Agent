import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Activity, AlertTriangle, Key, Pencil, Plus, Radio, Server, ShieldAlert, ShieldCheck, Trash2, X } from 'lucide-react'
import { LogStateResult, ModelConnectionSummary, TaskRouteSummary, TaskType } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { getEndpointHost } from '../../utils/crypto'
import { taskTypeLabels } from '../../utils/constants'
import { ConnectionEditDialog } from './ConnectionEditDialog'
import { ContentTargetConfirmDialog } from './ContentTargetConfirmDialog'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'
import { useToast } from '../common/Toast'

export function ConnectionDialog({
  sessionId,
  initialRoutes = [],
  isReadOnly,
  onClose,
  onRoutesChanged
}: {
  sessionId: string
  initialRoutes: TaskRouteSummary[]
  isReadOnly: boolean
  onClose: () => void
  onRoutesChanged: (routes: TaskRouteSummary[]) => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [tab, setTab] = useState<'connections' | 'taskRoutes' | 'privacy'>('connections')
  const [connections, setConnections] = useState<ModelConnectionSummary[]>([])
  const [connFilter, setConnFilter] = useState<'all' | 'generation' | 'embedding'>('all')
  const [editingConn, setEditingConn] = useState<ModelConnectionSummary | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [confirmingConn, setConfirmingConn] = useState<ModelConnectionSummary | null>(null)
  const [deletingConn, setDeletingConn] = useState<ModelConnectionSummary | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [routes, setRoutes] = useState<TaskRouteSummary[]>(initialRoutes)
  const [logState, setLogState] = useState<LogStateResult | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<Record<string, { success: boolean; latencyMs?: number; message?: string }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { showToast } = useToast()

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [connList, logs] = await Promise.all([
        window.novelAgent.connection.list(),
        window.novelAgent.diagnostics.getLogState()
      ])
      setConnections(connList)
      setLogState(logs)
    } catch (err) {
      setError(errorText(err, '加载连接数据失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredConnections = connections.filter((c) => {
    if (connFilter === 'all') return true
    return c.kind === connFilter
  })

  const generationConnections = connections.filter((c) => c.kind === 'generation')

  const handleTest = async (c: ModelConnectionSummary) => {
    setTestingId(c.id)
    try {
      const res = await window.novelAgent.connection.test({ connectionId: c.id })
      setTestStatus((prev) => ({ ...prev, [c.id]: res }))
    } catch (err) {
      setTestStatus((prev) => ({ ...prev, [c.id]: { success: false, message: errorText(err, '测试失败') } }))
    } finally {
      setTestingId(null)
    }
  }

  const handleDelete = (c: ModelConnectionSummary) => {
    setDeletingConn(c)
  }

  const handleConfirmDelete = async () => {
    if (!deletingConn) return
    setDeleteLoading(true)
    try {
      await window.novelAgent.connection.delete({ connectionId: deletingConn.id, expectedVersion: deletingConn.version })
      showToast(`已成功删除模型连接「${deletingConn.name}」`, 'success')
      setDeletingConn(null)
      await loadData()
    } catch (err) {
      setError(errorText(err, '删除连接失败'))
      setDeletingConn(null)
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleSetRoute = async (taskType: TaskType, connectionId: string | null) => {
    const existing = routes.find((r) => r.taskType === taskType)
    try {
      const updated = await window.novelAgent.connection.setTaskRoute({
        sessionId,
        taskType,
        connectionId,
        expectedVersion: existing?.version
      })
      let newRoutes: TaskRouteSummary[]
      if (updated) {
        newRoutes = routes.some((r) => r.taskType === taskType)
          ? routes.map((r) => r.taskType === taskType ? updated : r)
          : [...routes, updated]
      } else {
        newRoutes = routes.filter((r) => r.taskType !== taskType)
      }
      setRoutes(newRoutes)
      onRoutesChanged(newRoutes)
    } catch (err) {
      setError(errorText(err, '更新任务路由失败'))
    }
  }

  const handleToggleDetailedLogs = async (enabled: boolean) => {
    try {
      const updated = await window.novelAgent.diagnostics.setDetailedLogging({ enabled })
      setLogState(updated)
    } catch (err) {
      setError(errorText(err, '切换详细日志失败'))
    }
  }

  const handleClearDetailedLogs = async () => {
    try {
      await window.novelAgent.diagnostics.clearDetailedLogs()
      showToast('已清空当前会话详细日志！', 'success')
    } catch (err) {
      setError(errorText(err, '清空详细日志失败'))
    }
  }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={dialogRef} className="connection-dialog" role="dialog" aria-modal="true" aria-label="模型连接、任务路由与隐私" initial={{ opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2>模型连接、任务路由与隐私</h2>
            <p>管理 OpenAI 兼容端点、作品任务路由绑定与本地安全诊断</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div className="tab-bar">
          <button className={tab === 'connections' ? 'active' : ''} onClick={() => setTab('connections')}>
            <Radio size={14} />模型连接 ({connections.length})
          </button>
          <button className={tab === 'taskRoutes' ? 'active' : ''} onClick={() => setTab('taskRoutes')}>
            <Server size={14} />任务路由 (6类)
          </button>
          <button className={tab === 'privacy' ? 'active' : ''} onClick={() => setTab('privacy')}>
            <ShieldCheck size={14} />隐私与诊断
          </button>
        </div>

        {error && <div className="dialog-error"><p className="inline-error">{error}</p></div>}

        {tab === 'connections' && (
          <div className="conn-body">
            <div className="rel-toolbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button className="primary-button" disabled={isReadOnly} onClick={() => setIsCreating(true)}>
                  <Plus size={14} />新建模型连接
                </button>
                <div className="source-filter-chips">
                  <button className={connFilter === 'all' ? 'filter-chip active' : 'filter-chip'} onClick={() => setConnFilter('all')}>全部 ({connections.length})</button>
                  <button className={connFilter === 'generation' ? 'filter-chip active' : 'filter-chip'} onClick={() => setConnFilter('generation')}>生成模型</button>
                  <button className={connFilter === 'embedding' ? 'filter-chip active' : 'filter-chip'} onClick={() => setConnFilter('embedding')}>向量模型</button>
                </div>
              </div>
            </div>

            {loading ? (
              <p className="empty-hint">加载中...</p>
            ) : filteredConnections.length === 0 ? (
              <div className="conn-empty-card">
                <div className="conn-empty-icon">
                  <Radio size={22} />
                </div>
                <h3>暂无配置的模型连接</h3>
                <p>
                  配置兼容 OpenAI 协议的 API 端点，支持为小说续写、重写、知识提取及文学分析提供强大的 AI 创作能力。
                </p>
                <div className="conn-tips-pills">
                  <span className="conn-tip-chip">SiliconFlow 硅基流动</span>
                  <span className="conn-tip-chip">DeepSeek 官方 API</span>
                  <span className="conn-tip-chip">OpenAI / 兼容端点</span>
                  <span className="conn-tip-chip">本地 Ollama (localhost)</span>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  disabled={isReadOnly}
                  onClick={() => setIsCreating(true)}
                  style={{ marginTop: 6 }}
                >
                  <Plus size={14} />新建首个模型连接
                </button>
              </div>
            ) : (
              <div className="conn-grid">
                {filteredConnections.map((c) => {
                  const test = testStatus[c.id]
                  const isConfirmed = Boolean(c.confirmedContentTargetFingerprint)
                  return (
                    <div key={c.id} className="conn-card">
                      <div className="conn-card-header">
                        <div className="conn-card-title">
                          <strong>{c.name}</strong>
                          <span>{c.model}</span>
                        </div>
                        <div className="conn-badges">
                          <span className={`badge-tag ${c.kind === 'generation' ? 'gen' : 'embed'}`}>{c.kind === 'generation' ? '生成' : '向量'}</span>
                          {c.hasSecret && <span className="badge-tag secret" title="已加密保存秘钥"><Key size={10} style={{ display: 'inline', marginRight: 2 }} />已配秘钥</span>}
                          {c.isLocalService && <span className="badge-tag local">本地服务</span>}
                          <span className={`badge-tag ${isConfirmed ? 'confirmed' : 'unconfirmed'}`}>
                            {isConfirmed ? '✓ 目标已确认' : '⚠ 目标未确认'}
                          </span>
                        </div>
                      </div>

                      <div className="conn-meta-info">
                        <div className="conn-meta-row"><span>主机:</span><strong>{getEndpointHost(c.baseUrl)}</strong></div>
                        <div className="conn-meta-row"><span>Base URL:</span><span style={{ wordBreak: 'break-all' }}>{c.baseUrl}</span></div>
                        {c.kind === 'generation' && (
                          <div className="conn-meta-row">
                            <span>上下文 / 输出:</span>
                            <span>{(c.contextWindow / 1000).toFixed(0)}k / {(c.maxOutputTokens / 1000).toFixed(0)}k</span>
                          </div>
                        )}
                        {test && (
                          <div style={{ marginTop: 4, fontSize: 11, color: test.success ? '#2d5a27' : '#b91c1c' }}>
                            {test.success ? `✓ 测试通过 (${test.latencyMs}ms)` : `✗ 测试失败: ${test.message}`}
                          </div>
                        )}
                      </div>

                      <div className="conn-card-actions">
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="text-button" disabled={testingId === c.id} onClick={() => void handleTest(c)}>
                            <Activity size={13} />{testingId === c.id ? '测试中...' : '测试'}
                          </button>
                          {!isConfirmed && (
                            <button type="button" className="text-button" style={{ color: '#d97706' }} onClick={() => setConfirmingConn(c)}>
                              <ShieldAlert size={13} />确认目标
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="text-button" disabled={isReadOnly} onClick={() => setEditingConn(c)}>
                            <Pencil size={13} />编辑
                          </button>
                          <button type="button" className="text-button" style={{ color: '#b91c1c' }} disabled={isReadOnly} onClick={() => void handleDelete(c)}>
                            <Trash2 size={13} />删除
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'taskRoutes' && (
          <div className="task-route-pane">
            <div className="alert-banner warning" style={{ fontSize: 12 }}>
              <Server size={16} style={{ flexShrink: 0 }} />
              <span>任务路由定义当前小说项目在各项写作与分析任务中使用的具体生成模型连接。任务路由随项目持久化保存。</span>
            </div>

            <div className="task-route-list">
              {(['continue', 'rewrite', 'polish', 'knowledge', 'report', 'chat'] as TaskType[]).map((taskType) => {
                const info = taskTypeLabels[taskType]
                const route = routes.find((r) => r.taskType === taskType)
                const boundConnId = route?.connectionId || ''
                const resolution = route?.resolution || 'unresolved'

                return (
                  <div key={taskType} className="task-route-card">
                    <div className="task-route-info">
                      <div className="task-route-title">{info.title}</div>
                      <div className="task-route-desc">{info.desc}</div>
                    </div>

                    <div className="task-route-select-wrapper">
                      <select
                        value={boundConnId}
                        disabled={isReadOnly}
                        onChange={(e) => {
                          const val = e.target.value ? e.target.value : null
                          void handleSetRoute(taskType, val)
                        }}
                      >
                        <option value="">-- 未绑定 (使用默认或任务回退) --</option>
                        {generationConnections.map((c) => (
                          <option key={c.id} value={c.id}>{c.name} ({c.model})</option>
                        ))}
                      </select>

                      <span className={`route-badge ${boundConnId ? (resolution === 'resolved' ? 'resolved' : 'unresolved') : 'none'}`}>
                        {boundConnId ? (resolution === 'resolved' ? '✓ 已绑定' : '⚠ 连接缺失') : '未绑定'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'privacy' && (
          <div className="privacy-pane">
            <div className="privacy-box">
              <h3>🔒 本地优先与隐私保护策略</h3>
              <p>1. <strong>数据驻留本地</strong>：您的小说正文、快照、设定库与任务路由全部保存在本机的 SQLite 数据库中，绝不会在后台被自动上传或汇总。</p>
              <p>2. <strong>目标确认闸门 (Content Target Gate)</strong>：任何携带小说正文或世界观设定的 AI 任务执行前，系统必须核验该端点已获得作者明确确认，杜绝误发送。</p>
              <p>3. <strong>系统级加密存储</strong>：API Key 与敏感鉴权信息在本地通过 OS 凭据库 (Electron safeStorage / AES-256-GCM) 严密加密，严禁随作品项目文件分发。</p>
            </div>

            <div className="privacy-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3>会话详细诊断日志</h3>
                  <p>开启后将把请求 payload 与模型响应记录至当前会话调试目录。退出应用时将自动彻底销毁。</p>
                </div>
                <label className="checkbox-field" style={{ margin: 0, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(logState?.detailedLoggingEnabled)}
                    onChange={(e) => void handleToggleDetailedLogs(e.target.checked)}
                  />
                  <span>开启详细日志</span>
                </label>
              </div>

              {logState?.detailedLoggingEnabled && (
                <div className="alert-banner warning">
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <span>⚠️ 详细日志已开启：小说正文、提示词及返回内容将写入当前临时调试目录。</span>
                </div>
              )}

              {logState?.logDirectory && (
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  日志存储路径: <code style={{ wordBreak: 'break-all' }}>{logState.logDirectory}</code>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                <button type="button" className="text-button" onClick={() => void handleClearDetailedLogs()}>
                  <Trash2 size={13} />清空会话详细日志
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="dialog-footer">
          <span>单连接串行优先调度 · 429 退避重试 · 1次结构化 JSON 修复</span>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </footer>
      </motion.div>

      <AnimatePresence>
        {isCreating && (
          <ConnectionEditDialog
            connection={null}
            initialKind="generation"
            onClose={() => setIsCreating(false)}
            onSaved={() => {
              setIsCreating(false)
              void loadData()
            }}
          />
        )}
        {editingConn && (
          <ConnectionEditDialog
            connection={editingConn}
            onClose={() => setEditingConn(null)}
            onSaved={() => {
              setEditingConn(null)
              void loadData()
            }}
          />
        )}
        {confirmingConn && (
          <ContentTargetConfirmDialog
            connection={confirmingConn}
            onClose={() => setConfirmingConn(null)}
            onConfirmed={() => {
              setConfirmingConn(null)
              void loadData()
            }}
          />
        )}
        {deletingConn && (
          <ConfirmActionDialog
            key="confirm-delete-conn"
            isOpen={Boolean(deletingConn)}
            title="确认删除模型连接"
            message={`确定删除模型连接「${deletingConn.name}」吗？绑定的任务路由将变为 unresolved 状态。`}
            confirmText="删除连接"
            confirmVariant="danger"
            isLoading={deleteLoading}
            onConfirm={handleConfirmDelete}
            onCancel={() => setDeletingConn(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export const ConnectionManagerDialog = ConnectionDialog
