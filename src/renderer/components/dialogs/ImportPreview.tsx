import { useState, useRef } from 'react'
import { motion } from 'motion/react'
import { ArrowDown, ArrowUp, Merge, Split, X } from 'lucide-react'
import type { ImportPreviewResult, OpenProjectResult } from '../../../shared/project'
import { errorText, count } from '../../utils/formatters'
import { getChapterNumber } from '../../utils/chapter-numbering'
import { IconButton } from '../common/IconButton'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

type PreviewChapter = { id: string; title: string; content: string }

export function ImportPreview({
  preview,
  onClose,
  onImported
}: {
  preview: NonNullable<ImportPreviewResult>
  onClose: () => void
  onImported: (opened: OpenProjectResult) => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
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
        title: chapter.title.trim() || (getChapterNumber(chapters, index) === undefined ? '正文' : `第 ${getChapterNumber(chapters, index)} 章`),
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
    <motion.section className="import-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        ref={dialogRef}
        className="import-dialog"
        initial={{ opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.2 }}
      >
        <header className="dialog-header">
          <div>
            <h1>导入预览</h1>
            <p>确认章节结构与正文后创建本地作品项目。</p>
          </div>
          <div className="dialog-actions">
            <label>
              编码{' '}
              <select
                value={pendingEncoding ?? encoding}
                onChange={(event) => setPendingEncoding(event.target.value as typeof encoding)}
              >
                <option value="utf8">UTF-8</option>
                <option value="utf16le">UTF-16 LE</option>
                <option value="utf16be">UTF-16 BE</option>
                <option value="gb18030">GB18030</option>
              </select>
            </label>
            <IconButton label="关闭导入预览" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        </header>

        {pendingEncoding && (
          <div className="encoding-confirm">
            <span>切换编码会重置当前章节调整。</span>
            <div>
              <button className="text-button" onClick={() => setPendingEncoding(undefined)}>
                保留当前预览
              </button>
              <button className="primary-button" onClick={() => void changeEncoding()}>
                重新解析
              </button>
            </div>
          </div>
        )}

        <div className="import-project">
          <label>
            作品名称
            <input
              value={title}
              placeholder="请输入作品名称"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span title={preview.source} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px', color: '#6b7280' }}>
              原文副本: <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: '3px', fontFamily: 'monospace' }}>{preview.source}</code>
            </span>
            {confidence === 'low' && <span style={{ color: '#d97706', fontWeight: 500 }}>编码置信度低</span>}
          </div>
        </div>

        <div className="import-body">
          <aside className="import-list" role="listbox" aria-label="识别章节">
            <div className="panel-caption">识别章节 ({chapters.length})</div>
            {chapters.map((chapter, index) => {
              const chapterNumber = getChapterNumber(chapters, index)
              const titlePlaceholder = chapterNumber === undefined ? '前置内容' : `第 ${chapterNumber} 章`
              return (
                <div
                  key={chapter.id}
                  role="option"
                  aria-selected={index === selected}
                  tabIndex={0}
                  onClick={() => setSelected(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelected(index)
                    }
                  }}
                  className={index === selected ? 'import-row selected' : 'import-row'}
                >
                  <span>{chapterNumber ?? ''}</span>
                  <input
                    value={chapter.title}
                    placeholder={titlePlaceholder}
                    aria-label={`${titlePlaceholder}标题`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      setChapters((items) =>
                        items.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, title: event.target.value } : item
                        )
                      )
                    }
                  />
                </div>
              )
            })}
          </aside>

          <main className="import-text">
            <div className="panel-caption">
              <span>预览：{current.title || (currentChapterNumber === undefined ? '前置内容' : `第 ${currentChapterNumber} 章`)}</span>
              <span>{count(current.content)} 字</span>
            </div>
            <div className="preview-actions">
              <IconButton label="向上移动" onClick={() => move(-1)}>
                <ArrowUp size={17} />
              </IconButton>
              <IconButton label="向下移动" onClick={() => move(1)}>
                <ArrowDown size={17} />
              </IconButton>
              <IconButton label="在光标处分章" onClick={split}>
                <Split size={17} />
              </IconButton>
              <IconButton label="与下一章合并" onClick={merge}>
                <Merge size={17} />
              </IconButton>
            </div>
            <textarea
              ref={textarea}
              value={current.content}
              aria-label="章节正文预览"
              onChange={(event) => replace({ ...current, content: event.target.value })}
            />
          </main>
        </div>

        <footer className="dialog-footer">
          <span>{error || `${characterCount.toLocaleString()} 字`}</span>
          <div>
            <button className="text-button" onClick={onClose}>
              取消
            </button>
            <button className="primary-button" onClick={() => void finish()}>
              确认导入
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.section>
  )
}
