import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, Check, Copy, Eye, RotateCw, Sparkles, X } from 'lucide-react'
import {
  ChapterHeader,
  ChatWorkflowStage,
  ChatWorkflowType,
  ContextPackage,
  InstructionPreset,
  ModelConnectionSummary,
  StyleSample,
  TaskType,
  ContextItem,
  ExcludedContextItem,
  CreativityLevel
} from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function ContextPreviewDialog({
  sessionId,
  chapters,
  currentChapterId,
  initialTaskType = 'continue',
  initialStage,
  initialWorkflowType,
  initialOutlineId,
  initialOutlineVersion,
  chatSessionId,
  onClose,
  onStartCreation,
  onOpenConnections
}: {
  sessionId: string
  chapters: ChapterHeader[]
  currentChapterId?: string
  initialTaskType?: TaskType
  initialStage?: ChatWorkflowStage
  initialWorkflowType?: ChatWorkflowType
  initialOutlineId?: string
  initialOutlineVersion?: number
  chatSessionId?: string
  onClose: () => void
  onStartCreation?: (contextPackageId: string, taskType: TaskType) => void
  onOpenConnections?: () => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [taskType, setTaskType] = useState<TaskType>(initialTaskType)
  const [targetChapterId, setTargetChapterId] = useState<string>(currentChapterId || (chapters[0]?.id ?? ''))
  const [connections, setConnections] = useState<ModelConnectionSummary[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [presets, setPresets] = useState<InstructionPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [styleSamples, setStyleSamples] = useState<StyleSample[]>([])
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([])
  const [includeCreativeRules, setIncludeCreativeRules] = useState(true)
  const [targetLength, setTargetLength] = useState<number>(1000)
  const [creativity, setCreativity] = useState<'low' | 'medium' | 'high'>('medium')
  const [instruction, setInstruction] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [contextPackage, setContextPackage] = useState<ContextPackage | null>(null)
  const [activeTab, setActiveTab] = useState<'items' | 'system' | 'user'>('items')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const handleGeneratePreview = useCallback(async (connIdOverride?: string) => {
    const connId = connIdOverride || selectedConnectionId
    if (!connId) {
      setError('请选择模型连接')
      return
    }

    setPreviewing(true)
    setError('')
    try {
      const pkg = await window.novelAgent.context.preview({
        sessionId,
        connectionId: connId,
        taskType,
        stage: initialStage,
        workflowType: initialWorkflowType,
        outlineId: initialOutlineId,
        outlineVersion: initialOutlineVersion,
        chatSessionId,
        target: targetChapterId ? { chapterId: targetChapterId } : undefined,
        instruction,
        presetId: selectedPresetId || undefined,
        styleSampleIds: selectedStyleIds.length > 0 ? selectedStyleIds : undefined,
        includeCreativeRules,
        targetLength: targetLength > 0 ? targetLength : undefined,
        creativity
      })
      setContextPackage(pkg)
    } catch (err) {
      setError(errorText(err, '生成上下文装配预览失败'))
    } finally {
      setPreviewing(false)
    }
  }, [sessionId, selectedConnectionId, taskType, initialStage, initialWorkflowType, initialOutlineId, initialOutlineVersion, chatSessionId, targetChapterId, instruction, selectedPresetId, selectedStyleIds, includeCreativeRules, targetLength, creativity])

  const loadDependencies = useCallback(async () => {
    try {
      const [connList, presetList, sampleList] = await Promise.all([
        window.novelAgent.connection.list({ kind: 'generation' }),
        window.novelAgent.preset.list({ sessionId }),
        window.novelAgent.styleSample.list({ sessionId })
      ])
      setConnections(connList)
      let activeConn = selectedConnectionId
      if (connList.length > 0 && !activeConn) {
        activeConn = connList[0].id
        setSelectedConnectionId(activeConn)
      }
      setPresets(presetList)
      setStyleSamples(sampleList)
      if (activeConn) {
        void handleGeneratePreview(activeConn)
      }
    } catch {}
  }, [sessionId, selectedConnectionId, handleGeneratePreview])

  useEffect(() => {
    void loadDependencies()
  }, [loadDependencies])

  const handleCopyText = (text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleStyleSample = (id: string) => {
    setSelectedStyleIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const tokenUsagePercent = contextPackage
    ? Math.min(100, Math.round((contextPackage.estimatedInputTokens / Math.max(1, contextPackage.availableInputTokens)) * 100))
    : 0

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        ref={dialogRef}
        className="context-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="上下文装配预览与 Token 预算"
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4 }}
      >
        <header className="dialog-header">
          <div>
            <h2>上下文装配预览与 Token 预算</h2>
            <p>12 级优先级装配规则、Token 输入预算分配、不可裁剪内容保护及最终 Prompt 查看</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>

        {error && <div className="dialog-error"><p className="inline-error">{error}</p></div>}

        <div className="context-preview-body">
          {/* Controls Left Column */}
          <div className="context-controls-col">
            <div className="context-controls-scroll">
              <div className="context-form-group">
                <label>任务类型</label>
                <select
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value as TaskType)}
                >
                  <option value="continue">正文续写 (continue)</option>
                  <option value="rewrite">选区重写 (rewrite)</option>
                  <option value="polish">文字润色 (polish)</option>
                  <option value="chat">项目问答 (chat)</option>
                  <option value="knowledge">知识提取 (knowledge)</option>
                  <option value="report">文学报告 (report)</option>
                </select>
              </div>

              <div className="context-form-group">
                <label>目标章节</label>
                <select
                  value={targetChapterId}
                  onChange={(e) => setTargetChapterId(e.target.value)}
                >
                  {chapters.map((c, index) => {
                    const chapterNumber = getChapterNumber(chapters, index)
                    return (
                      <option key={c.id} value={c.id}>
                        {chapterNumber === undefined ? '' : `${chapterNumber}. `}{c.title} (v{c.version})
                      </option>
                    )
                  })}
                </select>
              </div>

              <div className="context-form-group">
                <label>模型连接</label>
                {connections.length === 0 ? (
                  <div className="no-conn-hint" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>未检测到生成模型</span>
                    </div>
                    <span style={{ color: '#b45309', fontSize: 11, lineHeight: 1.4 }}>
                      请先在工作台配置模型连接以启用装配与候选生成。
                    </span>
                    {onOpenConnections && (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={onOpenConnections}
                        style={{ fontSize: 11, padding: '3px 8px', marginTop: 2 }}
                      >
                        前往配置模型
                      </button>
                    )}
                  </div>
                ) : (
                  <select
                    value={selectedConnectionId}
                    onChange={(e) => setSelectedConnectionId(e.target.value)}
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.model})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="context-form-group">
                <label>指令预设 (可选)</label>
                <select
                  value={selectedPresetId}
                  onChange={(e) => setSelectedPresetId(e.target.value)}
                >
                  <option value="">(不使用预设)</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.taskType})</option>
                  ))}
                </select>
              </div>

              {styleSamples.length > 0 && (
                <div className="context-form-group">
                  <label>参考文风样本 ({selectedStyleIds.length})</label>
                  <div className="context-style-list">
                    {styleSamples.map((s) => (
                      <label key={s.id} className="context-style-item">
                        <input
                          type="checkbox"
                          checked={selectedStyleIds.includes(s.id)}
                          onChange={() => toggleStyleSample(s.id)}
                        />
                        <span>{s.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-row" style={{ gap: 10 }}>
                <div className="context-form-group" style={{ flex: 1 }}>
                  <label>目标字数</label>
                  <input
                    type="number"
                    value={targetLength}
                    onChange={(e) => setTargetLength(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="context-form-group" style={{ flex: 1 }}>
                  <label>创意倾向</label>
                  <select
                    value={creativity}
                    onChange={(e) => setCreativity(e.target.value as typeof creativity)}
                  >
                    <option value="low">低 (严谨)</option>
                    <option value="medium">中 (平衡)</option>
                    <option value="high">高 (探索)</option>
                  </select>
                </div>
              </div>

              <div className="context-form-group">
                <label className="checkbox-field" style={{ margin: 0, fontWeight: 500 }}>
                  <input
                    type="checkbox"
                    checked={includeCreativeRules}
                    onChange={(e) => setIncludeCreativeRules(e.target.checked)}
                  />
                  <span>注入全书创作规则 (第2优先级)</span>
                </label>
              </div>

              <div className="context-form-group">
                <label>本次任务指令</label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="输入对 AI 的具体写作要求..."
                  rows={3}
                />
              </div>
            </div>

            <div className="context-controls-actions">
              <button
                type="button"
                className="primary-button"
                disabled={previewing || !selectedConnectionId}
                onClick={() => void handleGeneratePreview()}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {previewing ? <RotateCw className="spin" size={14} /> : <Eye size={14} />}
                {previewing ? '装配中...' : '生成装配预览'}
              </button>
            </div>
          </div>

          {/* Result Right Column */}
          <div className="context-result-col">
            {!contextPackage ? (
              <div className="context-empty-preview">
                <div className="context-empty-icon">
                  <Sparkles size={24} />
                </div>
                <div>
                  <h3 style={{ margin: '0 0 6px', fontSize: 15, color: '#334155' }}>尚未生成装配预览</h3>
                  <p style={{ margin: 0, fontSize: 13, color: '#64748b', maxWidth: 360, lineHeight: 1.6 }}>
                    在左侧配置任务目标、参数与模型，点击「生成装配预览」即可查看 12 级优先级裁剪预算与组装后的 Prompt 全文。
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Token Budget Meter */}
                <div className="token-meter-box">
                  <div className="token-meter-header">
                    <span>
                      Token 预算消耗：<strong>{contextPackage.estimatedInputTokens.toLocaleString()}</strong> / {contextPackage.availableInputTokens.toLocaleString()} Tokens
                    </span>
                    <span style={{ fontWeight: 'bold', color: tokenUsagePercent > 90 ? '#b91c1c' : tokenUsagePercent > 75 ? '#d97706' : '#2d5a27' }}>
                      {tokenUsagePercent}%
                    </span>
                  </div>
                  <div className="token-meter-bar">
                    <div
                      className="token-meter-fill"
                      style={{
                        width: `${tokenUsagePercent}%`,
                        background: tokenUsagePercent > 90 ? '#ef4444' : tokenUsagePercent > 75 ? '#f59e0b' : '#2d5a27'
                      }}
                    />
                  </div>
                  <div className="token-meter-footer">
                    <span>包含 {contextPackage.items.length} 个上下文条目</span>
                    {contextPackage.excludedItems.length > 0 && (
                      <span style={{ color: '#b91c1c', fontWeight: 600 }}>
                        已裁剪 {contextPackage.excludedItems.length} 项超出预算条目
                      </span>
                    )}
                    <span>指纹: <code style={{ fontFamily: 'monospace', fontSize: 10 }}>{contextPackage.configurationFingerprint}</code></span>
                  </div>
                </div>

                {contextPackage.warnings.length > 0 && (
                  <div className="alert-banner warning" style={{ padding: '8px 12px', fontSize: 12 }}>
                    <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                    <span>{contextPackage.warnings.join('；')}</span>
                  </div>
                )}

                {/* Tabs */}
                <div className="dimension-tabs" style={{ margin: '4px 0 0' }}>
                  <button
                    className={`dimension-tab ${activeTab === 'items' ? 'active' : ''}`}
                    onClick={() => setActiveTab('items')}
                  >
                    上下文条目清单 ({contextPackage.items.length})
                  </button>
                  <button
                    className={`dimension-tab ${activeTab === 'system' ? 'active' : ''}`}
                    onClick={() => setActiveTab('system')}
                  >
                    System Prompt
                  </button>
                  <button
                    className={`dimension-tab ${activeTab === 'user' ? 'active' : ''}`}
                    onClick={() => setActiveTab('user')}
                  >
                    User Prompt
                  </button>
                </div>

                <div className="context-items-scroll-area">
                  {activeTab === 'items' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {contextPackage.items.map((item) => (
                        <div key={item.id} className="context-item-card">
                          <div className="context-item-left">
                            <span className="authority-level-badge" title={`优先级等级: ${item.authorityLevel}`}>
                              {item.authorityLevel}
                            </span>
                            <strong style={{ color: '#1e293b' }}>{item.title || item.sourceType}</strong>
                            <span style={{ color: '#64748b', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.selectionReason}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            {item.fixed && (
                              <span className="context-fixed-tag">
                                不可裁剪
                              </span>
                            )}
                            <span style={{ color: '#475569', fontWeight: 600, fontSize: 11 }}>
                              ~{item.estimatedTokens} tokens
                            </span>
                          </div>
                        </div>
                      ))}

                      {contextPackage.excludedItems.length > 0 && (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <h5 style={{ margin: '4px 0 2px', color: '#b91c1c', fontSize: 12 }}>被裁剪的低优先级项:</h5>
                          {contextPackage.excludedItems.map((ex, idx) => (
                            <div key={idx} className="context-excluded-item">
                              <span>{ex.title || ex.sourceType}</span>
                              <span>超出预算 (~{ex.estimatedTokens} tokens)</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'system' && (
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="text-button"
                        style={{ position: 'absolute', right: 0, top: 0, fontSize: 11 }}
                        onClick={() => handleCopyText(contextPackage.systemMessage)}
                      >
                        <Copy size={12} />
                        {copied ? '已复制' : '复制全文'}
                      </button>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, fontFamily: 'monospace', margin: 0, paddingTop: 24, lineHeight: 1.6 }}>
                        {contextPackage.systemMessage}
                      </pre>
                    </div>
                  )}

                  {activeTab === 'user' && (
                    <div style={{ position: 'relative' }}>
                      <button
                        type="button"
                        className="text-button"
                        style={{ position: 'absolute', right: 0, top: 0, fontSize: 11 }}
                        onClick={() => handleCopyText(contextPackage.userMessage)}
                      >
                        <Copy size={12} />
                        {copied ? '已复制' : '复制全文'}
                      </button>
                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, fontFamily: 'monospace', margin: 0, paddingTop: 24, lineHeight: 1.6 }}>
                        {contextPackage.userMessage}
                      </pre>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="dialog-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            上下文包写入数据库后具备唯一指纹，正文或配置变更将触发过时失效保护
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="text-button" onClick={onClose}>关闭</button>
            {onStartCreation && (
              <button
                type="button"
                className="primary-button"
                disabled={!contextPackage}
                onClick={() => {
                  if (contextPackage) onStartCreation(contextPackage.id, taskType)
                }}
              >
                <Sparkles size={14} />开始生成候选
              </button>
            )}
          </div>
        </footer>
      </motion.div>
    </motion.div>
  )
}
