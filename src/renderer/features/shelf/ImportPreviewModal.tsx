import React, { useState, useRef } from 'react'
import { motion } from 'motion/react'
import { ArrowDown, ArrowUp, Merge, Split, X, AlertTriangle } from 'lucide-react'
import type { ImportPreviewResult, OpenProjectResult } from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { count } from '../../../shared/text-counter'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { Button } from '../../components/ui/button'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

type PreviewChapter = { id: string; title: string; content: string }

export function ImportPreviewModal({
  preview,
  onClose,
  onImported
}: {
  preview: NonNullable<ImportPreviewResult>
  onClose: () => void
  onImported: (opened: OpenProjectResult) => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss<HTMLDivElement>({
    isOpen: true,
    onClose
  })
  const [title, setTitle] = useState(preview.suggestedTitle)
  const [chapters, setChapters] = useState<PreviewChapter[]>(() =>
    preview.chapters.map((chapter, index) => ({
      id: `chap-${index}-${Math.random().toString(36).slice(2, 9)}`,
      ...chapter
    }))
  )
  const [encoding, setEncoding] = useState(preview.encoding)
  const [confidence, setConfidence] = useState(preview.confidence)
  const [characterCount, setCharacterCount] = useState(preview.characterCount)
  const [pendingEncoding, setPendingEncoding] = useState<typeof encoding>()
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const current = chapters[selected] ?? { id: 'fallback', title: '正文', content: '' }
  const currentChapterNumber = getChapterNumber(chapters, selected)

  const replace = (item: PreviewChapter) =>
    setChapters((items) => items.map((old, index) => (index === selected ? item : old)))

  const move = (direction: -1 | 1) => {
    const target = selected + direction
    if (target < 0 || target >= chapters.length) return
    setChapters((items) => {
      const next = [...items]
      ;[next[selected], next[target]] = [next[target], next[selected]]
      return next
    })
    setSelected(target)
  }

  const split = () => {
    const offset = textarea.current?.selectionStart ?? current.content.length
    if (
      offset <= 0 ||
      offset >= current.content.length ||
      (/[\uD800-\uDBFF]/.test(current.content[offset - 1]) &&
        /[\uDC00-\uDFFF]/.test(current.content[offset]))
    )
      return
    const newId = `chap-split-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    setChapters((items) => [
      ...items.slice(0, selected),
      { ...current, content: current.content.slice(0, offset) },
      { id: newId, title: '新章节', content: current.content.slice(offset) },
      ...items.slice(selected + 1)
    ])
    setSelected(selected + 1)
  }

  const merge = () => {
    const next = chapters[selected + 1]
    if (!next) return
    replace({
      ...current,
      content: `${current.content}${
        current.content.endsWith('\n') || next.content.startsWith('\n') ? '' : '\n\n'
      }${next.content}`
    })
    setChapters((items) => items.filter((_, index) => index !== selected + 1))
  }

  const changeEncoding = async () => {
    if (!pendingEncoding) return
    try {
      const reset = await window.novelAgent.project.previewImport({
        source: preview.source,
        encoding: pendingEncoding
      })
      if (reset) {
        setEncoding(reset.encoding)
        setConfidence(reset.confidence)
        setCharacterCount(reset.characterCount)
        setTitle(reset.suggestedTitle)
        setChapters(
          reset.chapters.map((ch, index) => ({
            id: `chap-${index}-${Math.random().toString(36).slice(2, 9)}`,
            ...ch
          }))
        )
        setSelected(0)
      }
      setPendingEncoding(undefined)
      setError('')
    } catch (err) {
      setError(errorText(err, '无法按所选编码解析原文'))
    }
  }

  const finish = async () => {
    try {
      const finalTitle = title.trim() || preview.suggestedTitle || '未命名作品'
      const finalChapters = chapters.map((chapter, index) => ({
        title:
          chapter.title.trim() ||
          (getChapterNumber(chapters, index) === undefined
            ? '正文'
            : `第 ${getChapterNumber(chapters, index)} 章`),
        content: chapter.content
      }))
      const imported = await window.novelAgent.project.import({
        source: preview.source,
        encoding,
        title: finalTitle,
        chapters: finalChapters
      })
      if (imported) onImported(await window.novelAgent.project.open({ path: imported.path }))
    } catch (err) {
      setError(errorText(err, '导入失败，请检查文件与保存位置'))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      {...backdropProps}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="导入小说原文预览"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="flex flex-col w-full max-w-5xl h-[88vh] bg-[#faf8f5] border border-[#e5ddd3] rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5ddd3] bg-[#faf8f5]">
          <div>
            <h2 className="text-lg font-bold text-[#2c2523] font-serif">导入小说原文预览</h2>
            <p className="text-xs text-[#7d6b59]">确认章节划分与正文排版无误后创建本地工程。</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-[#7d6b59]">
              <span>文件编码:</span>
              <select
                value={pendingEncoding ?? encoding}
                onChange={(e) => setPendingEncoding(e.target.value as typeof encoding)}
                className="bg-[#efe6da] border border-[#dacdbe] rounded-lg px-2.5 py-1 text-xs text-[#2c2523] focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30"
              >
                <option value="utf8">UTF-8</option>
                <option value="utf16le">UTF-16 LE</option>
                <option value="utf16be">UTF-16 BE</option>
                <option value="gb18030">GB18030</option>
              </select>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-[#7d6b59] hover:bg-[#efe6da] rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {pendingEncoding && (
          <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between text-xs text-amber-800">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={14} />
              切换编码将根据新编码重新解析源文件，重置当前的章节调整。
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPendingEncoding(undefined)}>
                取消
              </Button>
              <Button size="sm" onClick={() => void changeEncoding()}>
                重新解析
              </Button>
            </div>
          </div>
        )}

        {/* Project Meta info */}
        <div className="px-6 py-3 border-b border-[#e5ddd3] bg-[#f5efe6]/50 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <span className="text-xs font-medium text-[#7d6b59] shrink-0">作品名称:</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入小说作品名称"
              className="flex-1 bg-[#faf8f5] border border-[#dacdbe] rounded-lg px-3 py-1.5 text-xs text-[#2c2523] focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30"
            />
          </div>
          <div className="flex items-center gap-3 text-xs text-[#7d6b59]">
            <span className="font-mono text-[11px] max-w-xs truncate" title={preview.source}>
              原文：{preview.source}
            </span>
            {confidence === 'low' && (
              <span className="text-amber-600 font-medium bg-amber-100 px-2 py-0.5 rounded-full text-[10px]">
                编码置信度低
              </span>
            )}
          </div>
        </div>

        {/* Body Split View */}
        <div className="flex-1 flex min-h-0">
          {/* Chapter list */}
          <div className="w-72 border-r border-[#e5ddd3] flex flex-col bg-[#faf8f5]">
            <div className="p-3 border-b border-[#e5ddd3] text-xs font-semibold text-[#7d6b59] flex items-center justify-between">
              <span>识别章节 ({chapters.length})</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {chapters.map((chapter, index) => {
                const chapterNumber = getChapterNumber(chapters, index)
                const titlePlaceholder = chapterNumber === undefined ? '前置内容' : `第 ${chapterNumber} 章`
                const isCurrent = index === selected
                return (
                  <div
                    key={chapter.id}
                    onClick={() => setSelected(index)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors ${
                      isCurrent
                        ? 'bg-[#2d6a4f] text-white'
                        : 'hover:bg-[#efe6da] text-[#2c2523]'
                    }`}
                  >
                    <span className="text-[10px] opacity-70 w-5 text-center font-mono">
                      {chapterNumber ?? ''}
                    </span>
                    <input
                      value={chapter.title}
                      placeholder={titlePlaceholder}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        setChapters((items) =>
                          items.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, title: e.target.value } : item
                          )
                        )
                      }
                      className={`flex-1 bg-transparent border-none p-0 text-xs focus:outline-none ${
                        isCurrent ? 'text-white placeholder:text-white/60' : 'text-[#2c2523] placeholder:text-[#baa997]'
                      }`}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Chapter preview and editing */}
          <div className="flex-1 flex flex-col bg-white">
            <div className="px-5 py-3 border-b border-[#e5ddd3] flex items-center justify-between bg-[#faf8f5]">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-[#2c2523]">
                  {current.title ||
                    (currentChapterNumber === undefined ? '前置内容' : `第 ${currentChapterNumber} 章`)}
                </span>
                <span className="text-[11px] text-[#7d6b59] bg-[#efe6da] px-2 py-0.5 rounded-full">
                  {count(current.content).toLocaleString()} 字
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move(-1)}
                  disabled={selected === 0}
                  title="上移章节"
                  className="h-7 px-2"
                >
                  <ArrowUp size={14} />
                  <span className="text-[11px]">上移</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move(1)}
                  disabled={selected === chapters.length - 1}
                  title="下移章节"
                  className="h-7 px-2"
                >
                  <ArrowDown size={14} />
                  <span className="text-[11px]">下移</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={split}
                  title="在当前光标处拆分章节"
                  className="h-7 px-2"
                >
                  <Split size={14} />
                  <span className="text-[11px]">光标处分章</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={merge}
                  disabled={selected >= chapters.length - 1}
                  title="与下一章合并"
                  className="h-7 px-2"
                >
                  <Merge size={14} />
                  <span className="text-[11px]">合并下一章</span>
                </Button>
              </div>
            </div>

            <textarea
              ref={textarea}
              value={current.content}
              onChange={(e) => replace({ ...current, content: e.target.value })}
              className="flex-1 p-6 text-sm leading-relaxed text-[#2c2523] resize-none outline-none font-serif bg-transparent overflow-y-auto"
              placeholder="章节正文内容..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#e5ddd3] bg-[#faf8f5]">
          <div className="text-xs text-[#7d6b59]">
            {error ? (
              <span className="text-red-600">{error}</span>
            ) : (
              <span>全书共 {characterCount.toLocaleString()} 字，已解析 {chapters.length} 章节</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button onClick={() => void finish()}>
              确认导入并开始写作
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
