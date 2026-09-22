import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  FileText,
  Layers,
  Plus,
  RefreshCw,
  ScrollText,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type {
  BookOutline,
  BookSynopsis,
  ChapterHeader,
  ChapterOutline,
  ChapterSummary,
  OutlineState,
  VolumeOutline
} from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText, formatDate } from '../../utils/formatters'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'
import { useToast } from '../common/Toast'
import { ConfirmActionDialog } from './ConfirmActionDialog'

const DEFAULT_OUTLINE_TEMPLATE = `# 全书大纲

## 核心主线与主题
- 故事主旨：
- 核心冲突：
- 最大危机与对抗势力：

## 关键角色与动机
- 主角：
- 核心搭档 / 关键配角：
- 反派 / 阻碍势力：

## 阶段推进 (三幕式结构)
### 第一幕：起因与踏入未知 (约 0% - 25%)
1. 现状与主角困境：
2. 触发事件：
3. 离开舒适圈 / 不可逆转的抉择：

### 第二幕：对抗、挫折与升级 (约 25% - 75%)
1. 新世界探索与初步盟友：
2. 规则摸索与阶段性小胜利：
3. 中点转折 (危机升级 / 真相显露)：
4. 绝境与至暗时刻 (重大失去 / 信仰动摇)：

### 第三幕：高潮与结局 (约 75% - 100%)
1. 最终领悟与绝地反击：
2. 决战与终极冲突化解：
3. 尾声与新秩序确立：
`

export function OutlineEditorDialog({
  sessionId,
  chapters,
  initialChapterId,
  isReadOnly,
  onClose,
  onLaunchAnalysis
}: {
  sessionId: string
  chapters: ChapterHeader[]
  initialChapterId?: string
  isReadOnly: boolean
  onClose: () => void
  onLaunchAnalysis?: (type: 'knowledge' | 'report' | 'synopsis') => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [activeTab, setActiveTab] = useState<'book' | 'volume' | 'chapter' | 'synopsis'>('book')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [summaryCount, setSummaryCount] = useState<number | null>(null)
  const [synopsis, setSynopsis] = useState<BookSynopsis | null>(null)
  const [summaries, setSummaries] = useState<ChapterSummary[]>([])

  // Book Outline State
  const [bookOutline, setBookOutline] = useState<BookOutline | null>(null)
  const [bookContent, setBookContent] = useState('')

  // Volume Outlines State
  const [volumes, setVolumes] = useState<VolumeOutline[]>([])
  const [selectedVolumeId, setSelectedVolumeId] = useState<string | null>(null)
  const [volumeTitle, setVolumeTitle] = useState('')
  const [volumeContent, setVolumeContent] = useState('')
  const [volumeVersion, setVolumeVersion] = useState(1)
  const [volumeState, setVolumeState] = useState<OutlineState>('draft')
  const [isCreatingVolume, setIsCreatingVolume] = useState(false)

  // Chapter Outlines State
  const [selectedChapterId, setSelectedChapterId] = useState<string>(initialChapterId || chapters[0]?.id || '')
  const [chapterOutlines, setChapterOutlines] = useState<ChapterOutline[]>([])
  const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(null)
  const [chapterOutlineContent, setChapterOutlineContent] = useState('')
  const [chapterOutlineVersion, setChapterOutlineVersion] = useState(1)
  const [chapterOutlineState, setChapterOutlineState] = useState<OutlineState>('draft')
  const [chapterOutlineVolumeId, setChapterOutlineVolumeId] = useState<string | null>(null)
  const [confirmDeleteVolume, setConfirmDeleteVolume] = useState(false)
  const [confirmDeleteChapterOutline, setConfirmDeleteChapterOutline] = useState(false)
  const { showToast } = useToast()

  // --- Load Data Callbacks ---

  const loadBookOutline = useCallback(async () => {
    try {
      const [bo, sums, syn] = await Promise.all([
        window.novelAgent.outline.getBookOutline({ sessionId }),
        window.novelAgent.chapterSummary.list({ sessionId }),
        window.novelAgent.synopsis.get({ sessionId })
      ])
      setBookOutline(bo)
      setBookContent(bo ? bo.content : '')
      setSummaryCount(sums.length)
      setSummaries(sums)
      setSynopsis(syn)
    } catch (err) {
      setError(errorText(err, '无法加载全书大纲'))
    }
  }, [sessionId])

  const loadVolumes = useCallback(async () => {
    try {
      const list = await window.novelAgent.outline.listVolumeOutlines({ sessionId })
      setVolumes(list)
      if (list.length > 0) {
        const found = list.find((v) => v.id === selectedVolumeId) || list[0]
        setSelectedVolumeId(found.id)
        setVolumeTitle(found.title)
        setVolumeContent(found.content)
        setVolumeVersion(found.version)
        setVolumeState(found.state)
        setIsCreatingVolume(false)
      } else {
        setSelectedVolumeId(null)
        setVolumeTitle('')
        setVolumeContent('')
        setIsCreatingVolume(false)
      }
    } catch (err) {
      setError(errorText(err, '无法加载分卷大纲'))
    }
  }, [sessionId, selectedVolumeId])

  const loadChapterOutlines = useCallback(async (chapId: string) => {
    if (!chapId) return
    try {
      const list = await window.novelAgent.outline.listChapterOutlines({ sessionId, chapterId: chapId })
      setChapterOutlines(list)
      if (list.length > 0) {
        // Prefer latest confirmed/current, else top
        const target = list.find((o) => o.state === 'confirmed' || o.state === 'current') || list[0]
        setSelectedOutlineId(target.id)
        setChapterOutlineContent(target.content)
        setChapterOutlineVersion(target.version)
        setChapterOutlineState(target.state)
        setChapterOutlineVolumeId(target.volumeId)
      } else {
        setSelectedOutlineId(null)
        setChapterOutlineContent(
          '### 【本章目标】\n\n### 【场景节拍】\n1. \n2. \n3. \n\n### 【人物与动机】\n\n### 【冲突与信息增量】\n\n### 【连续性风险】\n\n### 【结尾钩子】\n'
        )
        setChapterOutlineVersion(1)
        setChapterOutlineState('draft')
        setChapterOutlineVolumeId(null)
      }
    } catch (err) {
      setError(errorText(err, '无法加载章大纲'))
    }
  }, [sessionId])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadBookOutline(), loadVolumes()]).finally(() => setLoading(false))
  }, [loadBookOutline, loadVolumes])

  useEffect(() => {
    if (selectedChapterId) {
      void loadChapterOutlines(selectedChapterId)
    }
  }, [selectedChapterId, loadChapterOutlines])

  // --- Book Outline Actions ---

  const handleSaveBookOutline = async () => {
    if (isReadOnly) return
    setSaving(true)
    setError('')
    try {
      const saved = await window.novelAgent.outline.saveBookOutline({
        sessionId,
        content: bookContent,
        expectedVersion: bookOutline ? bookOutline.version : undefined
      })
      setBookOutline(saved)
      setBookContent(saved.content)
    } catch (err) {
      setError(errorText(err, '保存全书大纲失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmBookOutline = async () => {
    if (isReadOnly || !bookOutline) return
    setSaving(true)
    setError('')
    try {
      const confirmed = await window.novelAgent.outline.confirmBookOutline({
        sessionId,
        expectedVersion: bookOutline.version
      })
      setBookOutline(confirmed)
    } catch (err) {
      setError(errorText(err, '确认全书大纲失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleGenerateBookDraft = async () => {
    if (isReadOnly) return
    if (summaryCount === 0) {
      showToast('当前小说尚未提取章节剧情摘要，建议先启动全书分析以生成丰富、准确的故事大纲。', 'info')
    }
    setSaving(true)
    setError('')
    try {
      const draft = await window.novelAgent.outline.generateBookOutlineDraft({ sessionId })
      setBookOutline(draft)
      setBookContent(draft.content)
      showToast('已从分析数据生成全书大纲草稿', 'success')
    } catch (err) {
      setError(errorText(err, '生成全书大纲草稿失败'))
    } finally {
      setSaving(false)
    }
  }

  // --- Volume Outline Actions ---

  const handleSelectVolume = (vol: VolumeOutline) => {
    setSelectedVolumeId(vol.id)
    setVolumeTitle(vol.title)
    setVolumeContent(vol.content)
    setVolumeVersion(vol.version)
    setVolumeState(vol.state)
    setIsCreatingVolume(false)
  }

  const handleStartCreateVolume = () => {
    setIsCreatingVolume(true)
    setSelectedVolumeId(null)
    setVolumeTitle(`第${volumes.length + 1}卷 `)
    setVolumeContent('')
    setVolumeVersion(1)
    setVolumeState('draft')
  }

  const handleSaveVolume = async () => {
    if (isReadOnly) return
    if (!volumeTitle.trim()) {
      setError('卷标题不能为空')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (isCreatingVolume) {
        const created = await window.novelAgent.outline.createVolumeOutline({
          sessionId,
          title: volumeTitle.trim(),
          content: volumeContent
        })
        await loadVolumes()
        handleSelectVolume(created)
      } else if (selectedVolumeId) {
        const updated = await window.novelAgent.outline.updateVolumeOutline({
          sessionId,
          volumeId: selectedVolumeId,
          title: volumeTitle.trim(),
          content: volumeContent,
          expectedVersion: volumeVersion
        })
        await loadVolumes()
        handleSelectVolume(updated)
      }
    } catch (err) {
      setError(errorText(err, '保存分卷大纲失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteVolume = () => {
    if (isReadOnly || !selectedVolumeId) return
    setConfirmDeleteVolume(true)
  }

  const handleConfirmDeleteVolume = async () => {
    if (isReadOnly || !selectedVolumeId) return
    setSaving(true)
    setError('')
    try {
      await window.novelAgent.outline.deleteVolumeOutline({
        sessionId,
        volumeId: selectedVolumeId,
        expectedVersion: volumeVersion
      })
      showToast('已删除分卷大纲', 'success')
      setConfirmDeleteVolume(false)
      await loadVolumes()
    } catch (err) {
      setError(errorText(err, '删除分卷大纲失败'))
      setConfirmDeleteVolume(false)
    } finally {
      setSaving(false)
    }
  }

  const handleMoveVolume = async (index: number, direction: 'up' | 'down') => {
    if (isReadOnly) return
    const targetIdx = direction === 'up' ? index - 1 : index + 1
    if (targetIdx < 0 || targetIdx >= volumes.length) return
    const nextList = [...volumes]
    const temp = nextList[index]
    nextList[index] = nextList[targetIdx]
    nextList[targetIdx] = temp

    setSaving(true)
    setError('')
    try {
      const reordered = await window.novelAgent.outline.reorderVolumeOutlines({
        sessionId,
        volumes: nextList.map((v) => ({ id: v.id, expectedVersion: v.version }))
      })
      setVolumes(reordered)
    } catch (err) {
      setError(errorText(err, '调整分卷顺序失败'))
    } finally {
      setSaving(false)
    }
  }

  // --- Chapter Outline Actions ---

  const handleSelectChapterOutline = (outline: ChapterOutline) => {
    setSelectedOutlineId(outline.id)
    setChapterOutlineContent(outline.content)
    setChapterOutlineVersion(outline.version)
    setChapterOutlineState(outline.state)
    setChapterOutlineVolumeId(outline.volumeId)
  }

  const handleSaveChapterOutline = async (asDraft = true) => {
    if (isReadOnly || !selectedChapterId) return
    setSaving(true)
    setError('')
    try {
      const saved = await window.novelAgent.outline.saveChapterOutline({
        sessionId,
        outlineId: selectedOutlineId || undefined,
        chapterId: selectedChapterId,
        content: chapterOutlineContent,
        volumeId: chapterOutlineVolumeId,
        state: asDraft ? 'draft' : undefined,
        expectedVersion: selectedOutlineId ? chapterOutlineVersion : undefined
      })
      await loadChapterOutlines(selectedChapterId)
      handleSelectChapterOutline(saved)
    } catch (err) {
      setError(errorText(err, '保存章大纲失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmChapterOutline = async () => {
    if (isReadOnly || !selectedOutlineId) return
    setSaving(true)
    setError('')
    try {
      const confirmed = await window.novelAgent.outline.confirmChapterOutline({
        sessionId,
        outlineId: selectedOutlineId,
        expectedVersion: chapterOutlineVersion
      })
      await loadChapterOutlines(selectedChapterId)
      handleSelectChapterOutline(confirmed)
    } catch (err) {
      setError(errorText(err, '确认章大纲失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteChapterOutline = () => {
    if (isReadOnly || !selectedOutlineId) return
    setConfirmDeleteChapterOutline(true)
  }

  const handleConfirmDeleteChapterOutline = async () => {
    if (isReadOnly || !selectedOutlineId) return
    setSaving(true)
    setError('')
    try {
      await window.novelAgent.outline.deleteChapterOutline({
        sessionId,
        outlineId: selectedOutlineId,
        expectedVersion: chapterOutlineVersion
      })
      showToast('已删除章大纲版本', 'success')
      setConfirmDeleteChapterOutline(false)
      await loadChapterOutlines(selectedChapterId)
    } catch (err) {
      setError(errorText(err, '删除章大纲失败'))
      setConfirmDeleteChapterOutline(false)
    } finally {
      setSaving(false)
    }
  }

  const renderStateBadge = (state: OutlineState) => {
    switch (state) {
      case 'confirmed':
      case 'current':
        return <span className="badge-tag confirmed">已确认生效</span>
      case 'draft':
        return <span className="badge-tag unconfirmed">草稿中</span>
      case 'stale':
        return <span className="badge-tag stale" style={{ background: '#fee2e2', color: '#991b1b' }}>已过时 (正文已变动)</span>
      default:
        return null
    }
  }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        ref={dialogRef}
        className="synopsis-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="小说项目大纲"
        style={{ width: 'min(980px, 94vw)', height: 'min(740px, 88vh)' }}
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4 }}
      >
        <header className="dialog-header">
          <div>
            <h2>项目大纲管理</h2>
            <p>维护全书、分卷与章节 Markdown 大纲，为创作阶段提供结构化依据与版本门禁</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="tab-group" style={{ display: 'flex', gap: 6, background: '#f3f4f6', padding: 3, borderRadius: 6 }}>
              <button
                className={`tab-btn ${activeTab === 'book' ? 'active' : ''}`}
                style={{
                  border: 0,
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 600,
                  background: activeTab === 'book' ? '#fff' : 'transparent',
                  color: activeTab === 'book' ? '#2d5a27' : '#4b5563',
                  boxShadow: activeTab === 'book' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
                onClick={() => setActiveTab('book')}
              >
                <Compass size={14} style={{ display: 'inline', marginRight: 5, verticalAlign: -2 }} />
                全书大纲
              </button>
              <button
                className={`tab-btn ${activeTab === 'volume' ? 'active' : ''}`}
                style={{
                  border: 0,
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 600,
                  background: activeTab === 'volume' ? '#fff' : 'transparent',
                  color: activeTab === 'volume' ? '#2d5a27' : '#4b5563',
                  boxShadow: activeTab === 'volume' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
                onClick={() => setActiveTab('volume')}
              >
                <Layers size={14} style={{ display: 'inline', marginRight: 5, verticalAlign: -2 }} />
                分卷大纲 ({volumes.length})
              </button>
              <button
                className={`tab-btn ${activeTab === 'chapter' ? 'active' : ''}`}
                style={{
                  border: 0,
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 600,
                  background: activeTab === 'chapter' ? '#fff' : 'transparent',
                  color: activeTab === 'chapter' ? '#2d5a27' : '#4b5563',
                  boxShadow: activeTab === 'chapter' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
                onClick={() => setActiveTab('chapter')}
              >
                <FileText size={14} style={{ display: 'inline', marginRight: 5, verticalAlign: -2 }} />
                章大纲
              </button>
              <button
                className={`tab-btn ${activeTab === 'synopsis' ? 'active' : ''}`}
                style={{
                  border: 0,
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: 13,
                  fontWeight: 600,
                  background: activeTab === 'synopsis' ? '#fff' : 'transparent',
                  color: activeTab === 'synopsis' ? '#2d5a27' : '#4b5563',
                  boxShadow: activeTab === 'synopsis' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
                onClick={() => setActiveTab('synopsis')}
              >
                <ScrollText size={14} style={{ display: 'inline', marginRight: 5, verticalAlign: -2 }} />
                故事脉络与章节摘要 ({summaries.length})
              </button>
            </div>
            <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
          </div>
        </header>

        {error && (
          <div className="dialog-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="inline-error">{error}</p>
            <button className="text-button" onClick={() => setError('')} style={{ fontSize: 11 }}>清除</button>
          </div>
        )}

        <div className="synopsis-body" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 18, overflow: 'hidden' }}>
          {/* TAB 1: 全书大纲 */}
          {activeTab === 'book' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>全书宏观大纲</h3>
                  {bookOutline && (
                    <>
                      {renderStateBadge(bookOutline.state)}
                      <span style={{ fontSize: 12, color: '#6b7280' }}>版本 v{bookOutline.version}</span>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>更新于 {formatDate(bookOutline.updatedAt)}</span>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="text-button" disabled={isReadOnly || saving} onClick={() => void handleGenerateBookDraft()}>
                    <Sparkles size={14} />从分析汇总草稿
                  </button>
                  <button className="text-button" disabled={isReadOnly || saving} onClick={() => void handleSaveBookOutline()}>
                    保存草稿
                  </button>
                  <button className="primary-button" disabled={isReadOnly || saving || !bookOutline} onClick={() => void handleConfirmBookOutline()}>
                    <Check size={14} />确认生效
                  </button>
                </div>
              </div>

              {!bookOutline && !bookContent.trim() && summaryCount === 0 ? (
                <div className="outline-empty-card">
                  <div className="outline-empty-icon">
                    <Compass size={28} />
                  </div>
                  <h4 className="outline-empty-title">全书大纲尚未编排</h4>
                  <p className="outline-empty-desc">
                    全书宏观大纲依托于小说的章节摘要与核心设定。检测到当前小说尚未进行章节剧情提取，推荐先启动全书分析，AI 将自动分析剧情并为您生成一份结构完整的全书大纲草稿。
                  </p>
                  <div className="outline-empty-flow">
                    <span className="outline-empty-flow-step">
                      <span className="outline-empty-flow-badge">1</span>
                      逐章提取剧情与设定
                    </span>
                    <ArrowRight size={13} style={{ color: '#9ca3af' }} />
                    <span className="outline-empty-flow-step">
                      <span className="outline-empty-flow-badge">2</span>
                      AI 自动编排全书宏观大纲
                    </span>
                  </div>
                  <div className="outline-empty-actions">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={isReadOnly}
                      onClick={() => {
                        if (onLaunchAnalysis) {
                          onClose()
                          onLaunchAnalysis('knowledge')
                        } else {
                          void handleGenerateBookDraft()
                        }
                      }}
                    >
                      <Sparkles size={14} />
                      <span>立即开始分析并生成大纲</span>
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      style={{ border: '1px solid #d1d5db', padding: '6px 14px', borderRadius: 4 }}
                      disabled={isReadOnly}
                      onClick={() => setBookContent(DEFAULT_OUTLINE_TEMPLATE)}
                    >
                      ✍️ 使用标准三幕式模板手动填写
                    </button>
                  </div>
                </div>
              ) : (
                <textarea
                  value={bookContent}
                  disabled={isReadOnly}
                  placeholder="# 全书大纲\n\n## 故事主线与核心冲突\n\n## 主角动机与主要人物关系\n\n## 各阶段情节规划\n"
                  onChange={(e) => setBookContent(e.target.value)}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    resize: 'none',
                    padding: 16,
                    borderRadius: 4,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    lineHeight: 1.7
                  }}
                />
              )}
            </div>
          )}

          {/* TAB 2: 分卷大纲 */}
          {activeTab === 'volume' && (
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
              <div style={{ borderRight: '1px solid #e5e7eb', paddingRight: 14, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 13, color: '#4b5563' }}>分卷列表</h4>
                  <button className="text-button" style={{ padding: '4px 8px', fontSize: 12 }} disabled={isReadOnly} onClick={handleStartCreateVolume}>
                    <Plus size={14} />新建分卷
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {volumes.length === 0 ? (
                    <p className="empty-hint" style={{ marginTop: 20 }}>暂无分卷大纲</p>
                  ) : (
                    volumes.map((v, idx) => (
                      <div
                        key={v.id}
                        onClick={() => handleSelectVolume(v)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          borderRadius: 4,
                          border: '1px solid',
                          borderColor: selectedVolumeId === v.id ? '#2d5a27' : '#e5e7eb',
                          background: selectedVolumeId === v.id ? '#e8efe5' : '#fff',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v.title}
                          </div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                            v{v.version} · {v.state === 'confirmed' ? '已确认' : '草稿'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                          <IconButton label="上移" disabled={isReadOnly || idx === 0} onClick={() => void handleMoveVolume(idx, 'up')}>
                            <ArrowUp size={12} />
                          </IconButton>
                          <IconButton label="下移" disabled={isReadOnly || idx === volumes.length - 1} onClick={() => void handleMoveVolume(idx, 'down')}>
                            <ArrowDown size={12} />
                          </IconButton>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={volumeTitle}
                    disabled={isReadOnly}
                    placeholder="输入分卷名称（例如：第一卷 凡人问道）"
                    onChange={(e) => setVolumeTitle(e.target.value)}
                    style={{ flex: 1, marginRight: 12, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 14, fontWeight: 600 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!isCreatingVolume && selectedVolumeId && (
                      <IconButton label="删除分卷" disabled={isReadOnly || saving} onClick={() => void handleDeleteVolume()}>
                        <Trash2 size={16} />
                      </IconButton>
                    )}
                    <button className="primary-button" disabled={isReadOnly || saving} onClick={() => void handleSaveVolume()}>
                      {isCreatingVolume ? '创建分卷' : '保存修改'}
                    </button>
                  </div>
                </div>

                <textarea
                  value={volumeContent}
                  disabled={isReadOnly}
                  placeholder="# 分卷大纲\n\n## 本卷核心主线\n\n## 登场人物与冲突\n\n## 卷末高潮与收束"
                  onChange={(e) => setVolumeContent(e.target.value)}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    resize: 'none',
                    padding: 16,
                    borderRadius: 4,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    lineHeight: 1.7
                  }}
                />
              </div>
            </div>
          )}

          {/* TAB 3: 章大纲 */}
          {activeTab === 'chapter' && (
            <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
              <div style={{ borderRight: '1px solid #e5e7eb', paddingRight: 14, display: 'flex', flexDirection: 'column', minHeight: 0, gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#4b5563', marginBottom: 4, fontWeight: 600 }}>选择章节</label>
                  <select
                    value={selectedChapterId}
                    onChange={(e) => setSelectedChapterId(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff', fontSize: 13 }}
                  >
                    {chapters.map((chap, idx) => {
                      const chapterNumber = getChapterNumber(chapters, idx)
                      return (
                        <option key={chap.id} value={chap.id}>
                          {chapterNumber === undefined ? '' : `${chapterNumber}. `}{chap.title}
                        </option>
                      )
                    })}
                  </select>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <h4 style={{ margin: 0, fontSize: 12, color: '#4b5563' }}>大纲版本历史 ({chapterOutlines.length})</h4>
                  <button
                    className="text-button"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    disabled={isReadOnly}
                    onClick={() => {
                      setSelectedOutlineId(null)
                      setChapterOutlineContent('### 【本章目标】\n\n### 【场景节拍】\n1. \n2. \n3. \n\n### 【人物与动机】\n\n### 【冲突与信息增量】\n\n### 【连续性风险】\n\n### 【结尾钩子】\n')
                      setChapterOutlineVersion(1)
                      setChapterOutlineState('draft')
                    }}
                  >
                    <Plus size={12} />新建草稿
                  </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {chapterOutlines.length === 0 ? (
                    <p className="empty-hint">该章节尚无大纲记录</p>
                  ) : (
                    chapterOutlines.map((co) => (
                      <div
                        key={co.id}
                        onClick={() => handleSelectChapterOutline(co)}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 4,
                          border: '1px solid',
                          borderColor: selectedOutlineId === co.id ? '#2d5a27' : '#e5e7eb',
                          background: selectedOutlineId === co.id ? '#e8efe5' : '#fff',
                          cursor: 'pointer'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#1f2937' }}>
                            版本 v{co.version}
                          </span>
                          {renderStateBadge(co.state)}
                        </div>
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                          对齐正文 v{co.chapterVersion} · {formatDate(co.updatedAt)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>所属分卷:</span>
                    <select
                      value={chapterOutlineVolumeId || ''}
                      disabled={isReadOnly}
                      onChange={(e) => setChapterOutlineVolumeId(e.target.value || null)}
                      style={{ padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff', fontSize: 12 }}
                    >
                      <option value="">（不分配分卷）</option>
                      {volumes.map((v) => (
                        <option key={v.id} value={v.id}>{v.title}</option>
                      ))}
                    </select>
                    {renderStateBadge(chapterOutlineState)}
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    {selectedOutlineId && (
                      <IconButton label="删除大纲" disabled={isReadOnly || saving} onClick={() => void handleDeleteChapterOutline()}>
                        <Trash2 size={16} />
                      </IconButton>
                    )}
                    <button className="text-button" disabled={isReadOnly || saving} onClick={() => void handleSaveChapterOutline(true)}>
                      保存草稿
                    </button>
                    <button className="primary-button" disabled={isReadOnly || saving} onClick={async () => {
                      if (!selectedOutlineId) {
                        // First save then confirm
                        const saved = await window.novelAgent.outline.saveChapterOutline({
                          sessionId,
                          chapterId: selectedChapterId,
                          content: chapterOutlineContent,
                          volumeId: chapterOutlineVolumeId,
                          state: 'draft'
                        })
                        await window.novelAgent.outline.confirmChapterOutline({
                          sessionId,
                          outlineId: saved.id,
                          expectedVersion: saved.version
                        })
                        await loadChapterOutlines(selectedChapterId)
                      } else {
                        await handleConfirmChapterOutline()
                      }
                    }}>
                      <Check size={14} />确认锁定
                    </button>
                  </div>
                </div>

                <textarea
                  value={chapterOutlineContent}
                  disabled={isReadOnly}
                  placeholder="### 【本章目标】\n\n### 【场景节拍】\n1. \n2. \n3. \n\n### 【人物与动机】\n\n### 【冲突与信息增量】\n\n### 【连续性风险】\n\n### 【结尾钩子】\n"
                  onChange={(e) => setChapterOutlineContent(e.target.value)}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    resize: 'none',
                    padding: 16,
                    borderRadius: 4,
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    fontFamily: 'inherit',
                    fontSize: 14,
                    lineHeight: 1.7
                  }}
                />
              </div>
            </div>
          )}

          {/* TAB 4: 故事脉络与各章摘要 */}
          {activeTab === 'synopsis' && (
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="global-synopsis-card" style={{ margin: 0 }}>
                <div className="global-synopsis-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Compass size={18} style={{ color: '#2d5a27' }} />
                    <h3 style={{ margin: 0 }}>全书宏观故事脉络</h3>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {synopsis && (
                      <>
                        <span className={`badge-tag ${synopsis.state === 'current' ? 'confirmed' : 'unconfirmed'}`}>
                          {synopsis.state === 'current' ? '最新有效' : '已过时 (有章节变动)'}
                        </span>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>{formatDate(synopsis.createdAt)}</span>
                      </>
                    )}
                    <button
                      type="button"
                      className="primary-button"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                      disabled={isReadOnly}
                      onClick={() => {
                        if (summaries.length === 0 && onLaunchAnalysis) {
                          onClose()
                          onLaunchAnalysis('knowledge')
                        } else if (onLaunchAnalysis) {
                          onClose()
                          onLaunchAnalysis('synopsis')
                        }
                      }}
                    >
                      <Sparkles size={13} />
                      <span>{summaries.length === 0 ? '一键提取剧情并生成' : '重新生成故事脉络'}</span>
                    </button>
                  </div>
                </div>

                {!synopsis ? (
                  <div className="empty-copy" style={{ padding: '20px 0', textAlign: 'center' }}>
                    <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 12px' }}>
                      {summaries.length === 0
                        ? '暂无故事脉络。需先提取章节剧情与摘要，AI 将自动串联生成全书故事走向。'
                        : '已提取章节摘要，可点击右上角「重新生成故事脉络」自动提炼全书大纲。'}
                    </p>
                    {summaries.length === 0 && (
                      <button
                        type="button"
                        className="primary-button"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '0 auto', fontSize: 12.5 }}
                        disabled={isReadOnly}
                        onClick={() => {
                          if (onLaunchAnalysis) {
                            onClose()
                            onLaunchAnalysis('knowledge')
                          }
                        }}
                      >
                        <Sparkles size={13} />
                        <span>立即开始全书章节剧情分析</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="synopsis-text-content" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                    {synopsis.summary}
                  </div>
                )}
              </div>

              <div className="chapter-summaries-section">
                <h3 style={{ fontSize: 14, margin: '0 0 12px', color: '#374151' }}>各章节摘要明细 ({summaries.length})</h3>
                <div className="chapter-summaries-grid">
                  {summaries.length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', gridColumn: '1 / -1' }}>
                      <p className="empty-hint" style={{ marginBottom: 12 }}>
                        暂无章节摘要，请先通过剧情分析提取各章事实与摘要
                      </p>
                      <button
                        type="button"
                        className="text-button"
                        style={{ fontSize: 12, color: '#2d5a27', padding: '6px 12px', border: '1px solid #c0d4be', borderRadius: 4 }}
                        disabled={isReadOnly}
                        onClick={() => {
                          if (onLaunchAnalysis) {
                            onClose()
                            onLaunchAnalysis('knowledge')
                          }
                        }}
                      >
                        <Sparkles size={13} />
                        <span>启动章节剧情与知识分析</span>
                      </button>
                    </div>
                  ) : (
                    summaries.map((sum) => (
                      <div key={sum.id} className="chapter-summary-card">
                        <div className="chapter-summary-header">
                          <strong>{sum.chapterTitle ?? '章节'}</strong>
                          <span className={`badge-tag ${sum.state === 'current' ? 'confirmed' : 'unconfirmed'}`}>
                            {sum.state === 'current' ? `v${sum.chapterVersion}` : '已过时'}
                          </span>
                        </div>
                        <p className="chapter-summary-text">{sum.summary}</p>
                        <span className="chapter-summary-time">{formatDate(sum.createdAt)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {confirmDeleteVolume && (
          <ConfirmActionDialog
            key="confirm-delete-volume"
            isOpen={confirmDeleteVolume}
            title="确认删除分卷大纲"
            message={`确认删除分卷大纲「${volumeTitle || '未命名分卷'}」？此操作不可撤销。`}
            confirmText="删除分卷"
            confirmVariant="danger"
            isLoading={saving}
            onConfirm={handleConfirmDeleteVolume}
            onCancel={() => setConfirmDeleteVolume(false)}
          />
        )}
        {confirmDeleteChapterOutline && (
          <ConfirmActionDialog
            key="confirm-delete-chapter-outline"
            isOpen={confirmDeleteChapterOutline}
            title="确认删除章大纲版本"
            message={`确认删除此章大纲版本 (第 ${chapterOutlineVersion} 版)？此操作不可撤销。`}
            confirmText="删除版本"
            confirmVariant="danger"
            isLoading={saving}
            onConfirm={handleConfirmDeleteChapterOutline}
            onCancel={() => setConfirmDeleteChapterOutline(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
