import { useState, useEffect, useCallback } from 'react'
import { AnimatePresence } from 'motion/react'
import { ArrowDown, ArrowUp, Camera, Copy, Merge, Pencil, Split, Trash2 } from 'lucide-react'
import type { Chapter, ChapterSnapshot, ChapterSnapshotDetail } from '../../../shared/project'
import type { SaveState } from '../../types/editor'
import { errorText, count, formatDate } from '../../utils/formatters'
import { stateLabel, snapshotKindLabel } from '../../utils/constants'
import { IconButton } from '../common/IconButton'
import { CreateSnapshotDialog } from '../dialogs/CreateSnapshotDialog'
import { SnapshotPreviewDialog } from '../dialogs/SnapshotPreviewDialog'

export function Inspector({
  sessionId,
  chapter,
  state,
  isReadOnly,
  canMerge,
  canDelete,
  onRename,
  onMove,
  onSplit,
  onMerge,
  onDelete,
  onReload,
  onRetry,
  onCopy,
  onSnapshotRestored
}: {
  sessionId: string
  chapter: Chapter
  state: SaveState
  isReadOnly: boolean
  canMerge: boolean
  canDelete: boolean
  onRename: () => void
  onMove: (direction: -1 | 1) => void
  onSplit: () => void
  onMerge: () => void
  onDelete: () => void
  onReload: () => void
  onRetry: () => void
  onCopy: () => void
  onSnapshotRestored: (chapter: Chapter) => void
}) {
  const [snapshots, setSnapshots] = useState<ChapterSnapshot[]>([])
  const [creatingSnapshot, setCreatingSnapshot] = useState(false)
  const [snapshotError, setSnapshotError] = useState('')
  const [previewSnapshot, setPreviewSnapshot] = useState<ChapterSnapshotDetail | null>(null)

  const loadSnapshots = useCallback(async () => {
    try {
      const list = await window.novelAgent.chapter.listSnapshots({ sessionId, chapterId: chapter.id })
      setSnapshots(list)
    } catch {}
  }, [chapter.id, sessionId])

  useEffect(() => { void loadSnapshots() }, [loadSnapshots])

  const submitManualSnapshot = async (name: string) => {
    try {
      await window.novelAgent.chapter.createSnapshot({ sessionId, chapterId: chapter.id, expectedVersion: chapter.version, name })
      setCreatingSnapshot(false)
      setSnapshotError('')
      await loadSnapshots()
    } catch (err) {
      setSnapshotError(errorText(err, '创建快照失败'))
    }
  }

  const openSnapshotPreview = async (snapshotId: string) => {
    try {
      const detail = await window.novelAgent.chapter.getSnapshot({ sessionId, snapshotId })
      setPreviewSnapshot(detail)
    } catch {}
  }

  const restoreSnapshot = async () => {
    if (!previewSnapshot) return
    try {
      const updated = await window.novelAgent.chapter.restoreSnapshot({
        sessionId,
        snapshotId: previewSnapshot.id,
        expectedVersion: chapter.version
      })
      setPreviewSnapshot(null)
      onSnapshotRestored(updated)
      await loadSnapshots()
    } catch (err) {
      setSnapshotError(errorText(err, '恢复快照失败'))
    }
  }

  return (
    <div className="inspector-content">
      <div>
        <h2>章节信息</h2>
        <dl>
          <div><dt>状态</dt><dd>{stateLabel[state]}</dd></div>
          <div><dt>版本</dt><dd>v{chapter.version}</dd></div>
          <div><dt>字数</dt><dd>{count(chapter.content).toLocaleString()}</dd></div>
        </dl>
      </div>
      {state === 'conflict' && (
        <div className="conflict-box">
          <strong>保存冲突</strong>
          <p>本地草稿未丢失。</p>
          <button onClick={onReload}>重新载入</button>
          <button onClick={onCopy}><Copy size={14} />复制本地草稿</button>
        </div>
      )}
      {state === 'error' && (
        <div className="conflict-box">
          <strong>保存失败</strong>
          <p>本地草稿未丢失，自动重试已停止。</p>
          <button onClick={onRetry}>重试保存</button>
        </div>
      )}
      <div className="inspector-actions">
        <button onClick={onRename} disabled={isReadOnly}><Pencil size={16} />重命名</button>
        <button onClick={() => onMove(-1)} disabled={isReadOnly}><ArrowUp size={16} />上移</button>
        <button onClick={() => onMove(1)} disabled={isReadOnly}><ArrowDown size={16} />下移</button>
        <button onClick={onSplit} disabled={isReadOnly || state === 'conflict'}><Split size={16} />在光标处分章</button>
        <button onClick={onMerge} disabled={isReadOnly || state === 'conflict' || !canMerge}><Merge size={16} />与下一章合并</button>
        <button className="danger" onClick={onDelete} disabled={isReadOnly || !canDelete}><Trash2 size={16} />删除章节</button>
      </div>

      <div className="snapshot-section">
        <div className="section-header">
          <h2>历史快照 ({snapshots.length})</h2>
          <IconButton label="创建手动快照" onClick={() => { setSnapshotError(''); setCreatingSnapshot(true) }} disabled={isReadOnly}>
            <Camera size={15} />
          </IconButton>
        </div>
        {snapshotError && <p className="inline-error">{snapshotError}</p>}
        <div className="snapshot-list">
          {snapshots.length === 0 ? (
            <p className="empty-hint">暂无快照</p>
          ) : (
            snapshots.map((s) => (
              <button key={s.id} className="snapshot-row" onClick={() => void openSnapshotPreview(s.id)}>
                <div className="snapshot-row-header">
                  <span className={`kind-tag ${s.snapshotKind}`}>{snapshotKindLabel[s.snapshotKind] || s.snapshotKind}</span>
                  <span className="snapshot-name">{s.name || `v${s.chapterVersion}`}</span>
                </div>
                <span className="snapshot-time">{formatDate(s.createdAt)}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <AnimatePresence>
        {creatingSnapshot && (
          <CreateSnapshotDialog
            error={snapshotError}
            onCancel={() => { setCreatingSnapshot(false); setSnapshotError('') }}
            onConfirm={(name) => void submitManualSnapshot(name)}
          />
        )}
        {previewSnapshot && (
          <SnapshotPreviewDialog
            snapshot={previewSnapshot}
            onClose={() => setPreviewSnapshot(null)}
            onRestore={() => void restoreSnapshot()}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
