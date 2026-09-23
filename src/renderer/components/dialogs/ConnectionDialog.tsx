import { useState, useEffect, useCallback } from 'react'
import {
  Activity,
  Key,
  Pencil,
  Plus,
  Radio,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import {
  LogStateResult,
  ModelConnectionSummary,
  TaskRouteSummary,
  TaskType
} from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { getEndpointHost } from '../../utils/crypto'
import { taskTypeLabels } from '../../utils/constants'
import { ConnectionEditDialog } from './ConnectionEditDialog'
import { ContentTargetConfirmDialog } from './ContentTargetConfirmDialog'
import { ConfirmActionDialog } from './ConfirmActionDialog'
import { useToast } from '../common/Toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@appica/ui-react/tabs'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { Checkbox } from '@appica/ui-react/checkbox'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@appica/ui-react/select'

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
  const [testStatus, setTestStatus] = useState<
    Record<string, { success: boolean; latencyMs?: number; message?: string }>
  >({})
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
      setTestStatus((prev) => ({
        ...prev,
        [c.id]: { success: false, message: errorText(err, '测试失败') }
      }))
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
      await window.novelAgent.connection.delete({
        connectionId: deletingConn.id,
        expectedVersion: deletingConn.version
      })
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
          ? routes.map((r) => (r.taskType === taskType ? updated : r))
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
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="flex flex-col w-[90vw] max-w-[90vw] h-[90vh] p-6" closeLabel="关闭">
          <DialogHeader>
            <DialogTitle>模型连接、任务路由与隐私</DialogTitle>
            <DialogDescription>
              管理 OpenAI 兼容端点、作品任务路由绑定与本地安全诊断
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={tab}
            onValueChange={(val) => setTab(val as any)}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="self-start">
              <TabsTrigger value="connections" className="gap-1.5">
                <Radio size={14} />
                模型连接 ({connections.length})
              </TabsTrigger>
              <TabsTrigger value="taskRoutes" className="gap-1.5">
                <Server size={14} />
                任务路由 (6类)
              </TabsTrigger>
              <TabsTrigger value="privacy" className="gap-1.5">
                <ShieldCheck size={14} />
                隐私与诊断
              </TabsTrigger>
            </TabsList>

            {error && <p className="inline-error text-xs text-red-600 mt-2">{error}</p>}

            {/* Tab 1: Connections */}
            <TabsContent value="connections" className="flex flex-1 flex-col overflow-hidden gap-3 mt-2">
              <div className="flex items-center justify-between border-b border-[#e5ddd3] pb-2 text-xs">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={isReadOnly}
                    onClick={() => setIsCreating(true)}
                  >
                    <Plus size={14} />
                    新建模型连接
                  </Button>
                  <div className="flex gap-1">
                    {[
                      { id: 'all', label: `全部 (${connections.length})` },
                      { id: 'generation', label: '生成模型' },
                      { id: 'embedding', label: '向量模型' }
                    ].map((f) => (
                      <Button
                        key={f.id}
                        type="button"
                        variant={connFilter === f.id ? 'primary' : 'ghost'}
                        size="sm"
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                          connFilter === f.id
                            ? 'bg-[#2d6a4f] text-white'
                            : 'bg-[#efe6da] text-[#7d6b59] hover:bg-[#e5ddd3]'
                        }`}
                        onClick={() => setConnFilter(f.id as any)}
                      >
                        {f.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <ScrollArea className="flex-1 pr-3">
                {loading ? (
                  <p className="p-12 text-center text-xs text-[#7d6b59]">加载中...</p>
                ) : filteredConnections.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-[#7d6b59]">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#efe6da] text-[#2d6a4f]">
                      <Radio size={22} />
                    </div>
                    <h3 className="text-sm font-semibold text-[#2c2523]">暂无配置的模型连接</h3>
                    <p className="max-w-md text-xs leading-relaxed text-[#7d6b59]">
                      配置兼容 OpenAI 协议的 API 端点，支持为小说续写、重写、知识提取及文学分析提供强大的 AI 创作能力。
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center pt-1">
                      {['SiliconFlow 硅基流动', 'DeepSeek 官方 API', 'OpenAI / 兼容端点', '本地 Ollama (localhost)'].map(
                        (tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        )
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={isReadOnly}
                      onClick={() => setIsCreating(true)}
                      className="mt-2"
                    >
                      <Plus size={14} />
                      新建首个模型连接
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 p-1">
                    {filteredConnections.map((c) => {
                      const test = testStatus[c.id]
                      const isConfirmed = Boolean(c.confirmedContentTargetFingerprint)
                      return (
                        <Card key={c.id} className="flex flex-col gap-2.5 p-4 bg-white border-[#e5ddd3]">
                          <div className="flex items-start justify-between">
                            <div className="flex flex-col gap-0.5">
                              <strong className="text-sm text-[#2c2523]">{c.name}</strong>
                              <span className="font-mono text-xs text-[#7d6b59]">{c.model}</span>
                            </div>
                            <div className="flex flex-wrap gap-1 justify-end">
                              <Badge variant={c.kind === 'generation' ? 'primary' : 'secondary'}>
                                {c.kind === 'generation' ? '生成' : '向量'}
                              </Badge>
                              {c.hasSecret && (
                                <Badge variant="outline" className="gap-1">
                                  <Key size={10} />
                                  已配秘钥
                                </Badge>
                              )}
                              {c.isLocalService && <Badge variant="secondary">本地</Badge>}
                              <Badge variant={isConfirmed ? 'primary' : 'secondary'}>
                                {isConfirmed ? '✓ 目标已确认' : '⚠ 目标未确认'}
                              </Badge>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1 rounded-lg bg-[#faf8f5] p-2 text-xs text-[#7d6b59]">
                            <div className="flex justify-between">
                              <span>主机:</span>
                              <strong className="text-[#2c2523]">{getEndpointHost(c.baseUrl)}</strong>
                            </div>
                            <div className="flex justify-between">
                              <span>Base URL:</span>
                              <span className="font-mono text-[11px] truncate max-w-[200px]">
                                {c.baseUrl}
                              </span>
                            </div>
                            {c.kind === 'generation' && (
                              <div className="flex justify-between">
                                <span>上下文 / 输出:</span>
                                <span>
                                  {(c.contextWindow / 1000).toFixed(0)}k / {(c.maxOutputTokens / 1000).toFixed(0)}k
                                </span>
                              </div>
                            )}
                            {test && (
                              <div
                                className={`text-[11px] font-medium pt-1 ${
                                  test.success ? 'text-emerald-700' : 'text-red-700'
                                }`}
                              >
                                {test.success
                                  ? `✓ 测试通过 (${test.latencyMs}ms)`
                                  : `✗ 测试失败: ${test.message}`}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center justify-between border-t border-[#f5efe6] pt-2">
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={testingId === c.id}
                                onClick={() => void handleTest(c)}
                              >
                                <Activity size={13} className={testingId === c.id ? 'animate-spin' : ''} />
                                {testingId === c.id ? '测试中...' : '测试'}
                              </Button>
                              {!isConfirmed && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-amber-700 border-amber-300"
                                  onClick={() => setConfirmingConn(c)}
                                >
                                  <ShieldAlert size={13} />
                                  确认目标
                                </Button>
                              )}
                            </div>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                disabled={isReadOnly}
                                onClick={() => setEditingConn(c)}
                              >
                                <Pencil size={13} />
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-red-600 hover:text-red-700"
                                disabled={isReadOnly}
                                onClick={() => void handleDelete(c)}
                              >
                                <Trash2 size={13} />
                                删除
                              </Button>
                            </div>
                          </div>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>

            {/* Tab 2: Task Routes */}
            <TabsContent value="taskRoutes" className="flex flex-1 flex-col overflow-hidden gap-3 mt-2">
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 shrink-0">
                <Server size={16} className="shrink-0 mt-0.5" />
                <span>
                  任务路由定义当前小说项目在各项写作与分析任务中使用的具体生成模型连接。任务路由随项目持久化保存。
                </span>
              </div>

              <ScrollArea className="flex-1 pr-3">
                <div className="flex flex-col gap-2.5 p-1">
                  {(['continue', 'rewrite', 'polish', 'knowledge', 'report', 'chat'] as TaskType[]).map(
                    (taskType) => {
                      const info = taskTypeLabels[taskType]
                      const route = routes.find((r) => r.taskType === taskType)
                      const boundConnId = route?.connectionId || ''
                      const resolution = route?.resolution || 'unresolved'

                      return (
                        <Card
                          key={taskType}
                          className="flex items-center justify-between p-3.5 bg-white border-[#e5ddd3]"
                        >
                          <div className="flex flex-col gap-0.5">
                            <strong className="text-xs text-[#2c2523]">{info.title}</strong>
                            <span className="text-[11px] text-[#7d6b59]">{info.desc}</span>
                          </div>

                          <div className="flex items-center gap-3">
                            <Select
                              value={boundConnId || 'unbound'}
                              disabled={isReadOnly}
                              onValueChange={(val) => {
                                const resolvedVal = val === 'unbound' || !val ? null : (val as string)
                                void handleSetRoute(taskType, resolvedVal)
                              }}
                            >
                              <SelectTrigger className="rounded-lg border border-[#dacdbe] bg-white px-3 py-1.5 text-xs text-[#2c2523] outline-none min-w-[240px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unbound">-- 未绑定 (使用默认或任务回退) --</SelectItem>
                                {generationConnections.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.name} ({c.model})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>

                            <Badge
                              variant={
                                boundConnId
                                  ? resolution === 'resolved'
                                    ? 'primary'
                                    : 'error'
                                  : 'secondary'
                              }
                            >
                              {boundConnId
                                ? resolution === 'resolved'
                                  ? '✓ 已绑定'
                                  : '⚠ 连接缺失'
                                : '未绑定'}
                            </Badge>
                          </div>
                        </Card>
                      )
                    }
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* Tab 3: Privacy */}
            <TabsContent value="privacy" className="flex flex-1 flex-col overflow-hidden gap-3 mt-2">
              <ScrollArea className="flex-1 pr-3">
                <div className="flex flex-col gap-4 p-1">
                  <Card className="flex flex-col gap-2 p-4 bg-white border-[#e5ddd3] text-xs leading-relaxed text-[#54473b]">
                    <h3 className="text-sm font-semibold text-[#2c2523]">
                      🔒 本地优先与隐私保护策略
                    </h3>
                    <p>
                      1. <strong>数据驻留本地</strong>
                      ：您的小说正文、快照、设定库与任务路由全部保存在本机的 SQLite
                      数据库中，绝不会在后台被自动上传或汇总。
                    </p>
                    <p>
                      2. <strong>目标确认闸门 (Content Target Gate)</strong>
                      ：任何携带小说正文或世界观设定的 AI
                      任务执行前，系统必须核验该端点已获得作者明确确认，杜绝误发送。
                    </p>
                    <p>
                      3. <strong>系统级加密存储</strong>：API Key 与敏感鉴权信息在本地通过 OS
                      凭据库 (Electron safeStorage / AES-256-GCM) 严密加密，严禁随作品项目文件分发。
                    </p>
                  </Card>

                  <Card className="flex flex-col gap-3 p-4 bg-white border-[#e5ddd3] text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col gap-1">
                        <h3 className="text-sm font-semibold text-[#2c2523]">会话详细诊断日志</h3>
                        <p className="text-[#7d6b59]">
                          开启后将把请求 payload 与模型响应记录至当前会话调试目录。退出应用时将自动彻底销毁。
                        </p>
                      </div>
                      <label className="flex items-center gap-2 font-semibold text-[#2c2523] cursor-pointer">
                        <Checkbox
                          checked={Boolean(logState?.detailedLoggingEnabled)}
                          onCheckedChange={(checked) => void handleToggleDetailedLogs(Boolean(checked))}
                        />
                        <span>开启详细日志</span>
                      </label>
                    </div>

                    {logState?.detailedLoggingEnabled && (
                      <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                        <ShieldAlert size={14} className="shrink-0" />
                        <span>
                          ⚠️ 详细日志已开启：小说正文、提示词及返回内容将写入当前临时调试目录。
                        </span>
                      </div>
                    )}

                    {logState?.logDirectory && (
                      <div className="text-[11px] text-[#7d6b59]">
                        日志存储路径:{' '}
                        <code className="font-mono text-[#54473b] break-all">
                          {logState.logDirectory}
                        </code>
                      </div>
                    )}

                    <div className="flex justify-end pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700 text-xs"
                        onClick={() => void handleClearDetailedLogs()}
                      >
                        <Trash2 size={13} />
                        清空会话详细日志
                      </Button>
                    </div>
                  </Card>
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-[11px] text-[#7d6b59]">
            <span>单连接串行优先调度 · 429 退避重试 · 1次结构化 JSON 修复</span>
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </>
  )
}

export const ConnectionManagerDialog = ConnectionDialog
