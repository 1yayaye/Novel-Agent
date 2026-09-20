import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { HardDrive, FolderOpen, RotateCcw, X } from 'lucide-react'
import { BackupInfo, OpenProjectResult } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText, formatDate, formatBytes } from '../../utils/formatters'
import { backupTagLabel } from '../../utils/constants'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function BackupDialog({ sessionId, onClose, onRestored }: { sessionId: string; onClose: () => void; onRestored: (opened: OpenProjectResult) => void }) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [restoringPath, setRestoringPath] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const list = await window.novelAgent.backup.list({ sessionId })
      setBackups(list)
      setError('')
    } catch (err) {
      setError(errorText(err, '无法加载备份列表'))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => { void load() }, [load])

  const createBackup = async () => {
    setCreating(true)
    setError('')
    try {
      await window.novelAgent.backup.create({ sessionId })
      await load()
    } catch (err) {
      setError(errorText(err, '创建备份失败'))
    } finally {
      setCreating(false)
    }
  }

  const openLocation = async () => {
    try {
      await window.novelAgent.backup.openLocation({ sessionId })
    } catch (err) {
      setError(errorText(err, '无法打开备份目录'))
    }
  }

  const restore = async (backupPath: string) => {
    try {
      const reopened = await window.novelAgent.backup.restore({ sessionId, backupPath })
      onRestored(reopened)
    } catch (err) {
      setError(errorText(err, '从备份恢复失败'))
      setRestoringPath(null)
    }
  }

  const getTagClass = (tag?: string) => {
    if (tag === 'daily') return 'daily'
    if (tag === 'manual') return 'manual'
    if (tag === 'pre_restore') return 'prerestore'
    return ''
  }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div ref={dialogRef} className="backup-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-manager-title" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2 id="backup-manager-title">项目备份管理</h2>
            <p>使用 SQLite 在线备份 API 生成一致性副本，每项目轮换保留最近 5 份。</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div className="backup-toolbar">
          <div className="backup-actions">
            <button className="primary-button" disabled={creating} onClick={() => void createBackup()}>
              <HardDrive size={14} />{creating ? '正在创建备份...' : '立即备份'}
            </button>
            <button className="text-button" onClick={() => void openLocation()}>
              <FolderOpen size={14} />打开目录
            </button>
          </div>
          <span className="backup-stat-pill">
            当前保留 <strong>{backups.length}</strong> / 5 份备份
          </span>
        </div>

        {error && <p className="inline-error dialog-error">{error}</p>}

        {restoringPath && (
          <div className="backup-confirm-box">
            <span>⚠️ 从该备份恢复将自动为当前状态创建「恢复前快照」并重载项目。确认恢复？</span>
            <div>
              <button type="button" className="text-button" onClick={() => setRestoringPath(null)}>取消</button>
              <button type="button" className="primary-button" onClick={() => void restore(restoringPath)}>确认恢复</button>
            </div>
          </div>
        )}

        <div className="backup-list">
          {loading ? (
            <p className="empty-hint">加载备份列表中...</p>
          ) : backups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
              <p style={{ margin: 0, fontSize: 13 }}>暂无备份记录。点击上方「立即备份」创建首份一致性副本。</p>
            </div>
          ) : (
            backups.map((b) => (
              <div className="backup-item" key={b.id}>
                <div className="backup-info">
                  <div className="backup-title">
                    <span className={`backup-tag ${getTagClass(b.tag)}`}>
                      {backupTagLabel[b.tag || ''] || b.tag || '备份'}
                    </span>
                    <strong title={b.id}>{b.id}</strong>
                  </div>
                  <span className="backup-meta">{formatDate(b.createdAt)} · {formatBytes(b.sizeBytes)}</span>
                </div>
                <button className="text-button restore-btn" onClick={() => setRestoringPath(b.path)}>
                  <RotateCcw size={14} />恢复
                </button>
              </div>
            ))
          )}
        </div>

        <footer className="dialog-footer">
          <span>达到 5 份上限后，系统在生成新备份时将自动循环覆盖最早的历史副本</span>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </footer>
      </motion.div>
    </motion.div>
  )
}

export const BackupManagerDialog = BackupDialog
