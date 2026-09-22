import React, { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { X, Sparkles, FileBarChart, Compass, RotateCw, Play, AlertTriangle } from 'lucide-react'
import { ChapterHeader, ModelConnectionSummary } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { getEndpointHost } from '../../utils/crypto'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function StartAnalysisDialog({
  sessionId,
  chapters,
  initialType = 'knowledge',
  isReadOnly,
  onClose,
  onStarted
}: {
  sessionId: string
  chapters: ChapterHeader[]
  initialType?: 'knowledge' | 'report' | 'synopsis'
  isReadOnly: boolean
  onClose: () => void
  onStarted: (taskId: string) => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [taskType, setTaskType] = useState<'knowledge' | 'report' | 'synopsis'>(initialType)
  const [scopeMode, setScopeMode] = useState<'all' | 'custom'>('all')
  const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>(chapters.map((c) => c.id))
  const [connections, setConnections] = useState<ModelConnectionSummary[]>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const list = await window.novelAgent.connection.list({ kind: 'generation' })
        setConnections(list)
        if (list.length > 0) {
          setSelectedConnectionId(list[0].id)
        }
      } catch {}
    })()
  }, [])

  const toggleChapter = (id: string) => {
    setSelectedChapterIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const handleStart = async () => {
    if (scopeMode === 'custom' && selectedChapterIds.length === 0 && taskType !== 'synopsis') {
      setError('请至少勾选一个章节')
      return
    }
    setLoading(true)
    setError('')
    try {
      const scope = scopeMode === 'all' ? { all: true } : { chapterIds: selectedChapterIds }
      const res = await window.novelAgent.analysis.start({
        sessionId,
        type: taskType,
        scope,
        connectionId: selectedConnectionId || undefined
      })
      onStarted(res.taskId)
      onClose()
    } catch (err) {
      setError(errorText(err, '启动任务失败'))
      setLoading(false)
    }
  }

  const selectedConn = connections.find((c) => c.id === selectedConnectionId)
  const isConfirmed = selectedConn ? Boolean(selectedConn.confirmedContentTargetFingerprint) : false

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={dialogRef} className="analysis-start-dialog" role="dialog" aria-modal="true" aria-label="发起分析任务" initial={{ opacity: 0, y: 10, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2>发起分析与生成任务</h2>
            <p>基于配置的模型连接，后台执行单章知识抽取、全书文学剖析或连贯故事大纲</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div className="analysis-start-body">
          {error && <div className="dialog-error"><p className="inline-error">{error}</p></div>}

          <div className="analysis-form-group">
            <label className="group-label">任务类型</label>
            <div className="task-type-selector">
              <button
                type="button"
                className={`task-type-card ${taskType === 'knowledge' ? 'active' : ''}`}
                onClick={() => setTaskType('knowledge')}
              >
                <div className="task-type-title">
                  <Sparkles size={16} />
                  <strong>知识设定提取与一致性检测</strong>
                </div>
                <p>逐章分析正文，提取人物/世界观/时间线事实，验证语义分块边界，并排查剧情漏洞与时间线矛盾</p>
              </button>

              <button
                type="button"
                className={`task-type-card ${taskType === 'report' ? 'active' : ''}`}
                onClick={() => setTaskType('report')}
              >
                <div className="task-type-title">
                  <FileBarChart size={16} />
                  <strong>文学分析报告 (六大维度)</strong>
                </div>
                <p>深度剖析主题思想、叙事视角、语言文风、节奏与结构、人物成长弧光及连续性逻辑</p>
              </button>

              <button
                type="button"
                className={`task-type-card ${taskType === 'synopsis' ? 'active' : ''}`}
                onClick={() => setTaskType('synopsis')}
              >
                <div className="task-type-title">
                  <Compass size={16} />
                  <strong>滚动故事梗概 (全书大纲)</strong>
                </div>
                <p>综合已生成的章节摘要，构建全局宏观故事演进大纲</p>
              </button>
            </div>
          </div>

          {taskType !== 'synopsis' && (
            <div className="analysis-form-group">
              <label className="group-label">分析章节范围</label>
              <div className="radio-group" style={{ marginBottom: 10 }}>
                <label>
                  <input
                    type="radio"
                    name="scopeMode"
                    value="all"
                    checked={scopeMode === 'all'}
                    onChange={() => setScopeMode('all')}
                  />
                  <span>全部章节 ({chapters.length} 章)</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="scopeMode"
                    value="custom"
                    checked={scopeMode === 'custom'}
                    onChange={() => setScopeMode('custom')}
                  />
                  <span>自定义勾选章节</span>
                </label>
              </div>

              {scopeMode === 'custom' && (
                <div className="export-chapter-select">
                  <div className="select-all-row">
                    <span>已选择 {selectedChapterIds.length} / {chapters.length} 章</span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 11, padding: '2px 6px' }}
                        onClick={() => setSelectedChapterIds(chapters.map((c) => c.id))}
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 11, padding: '2px 6px' }}
                        onClick={() => setSelectedChapterIds([])}
                      >
                        清空
                      </button>
                    </div>
                  </div>
                  <div className="chapter-checkbox-list">
                    {chapters.map((c) => (
                      <label key={c.id} className="chapter-check-item">
                        <input
                          type="checkbox"
                          checked={selectedChapterIds.includes(c.id)}
                          onChange={() => toggleChapter(c.id)}
                        />
                        <span>{c.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="analysis-form-group">
            <label className="group-label">执行模型连接</label>
            {connections.length === 0 ? (
              <p className="field-help" style={{ color: '#b91c1c' }}>
                当前尚未配置生成模型连接。请先前往「模型」配置连接。
              </p>
            ) : (
              <select
                value={selectedConnectionId}
                onChange={(e) => setSelectedConnectionId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff' }}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.model}) - {getEndpointHost(c.baseUrl)}
                  </option>
                ))}
              </select>
            )}

            {selectedConn && !isConfirmed && (
              <div className="alert-banner warning" style={{ marginTop: 8 }}>
                <AlertTriangle size={15} />
                <span>该连接的目标指纹尚未确认。发送请求时需进行联网目标确认。</span>
              </div>
            )}
          </div>
        </div>

        <footer className="dialog-footer">
          <span>任务在后台异步串行执行，可随时在「任务」面板查看实时进度与重试失败步骤</span>
          <div>
            <button type="button" className="text-button" onClick={onClose}>取消</button>
            <button
              type="button"
              className="primary-button"
              disabled={isReadOnly || loading || connections.length === 0}
              onClick={() => void handleStart()}
            >
              {loading ? <RotateCw className="spin" size={14} /> : <Play size={14} />}
              {loading ? '启动中...' : '开始执行任务'}
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  )
}
