import { useState, useEffect, useCallback } from 'react'
import { HardDrive, FolderOpen, RotateCcw } from 'lucide-react'
import { BackupInfo, OpenProjectResult } from '../../../shared/project'
import { errorText, formatDate, formatBytes } from '../../utils/formatters'
import { backupTagLabel } from '../../utils/constants'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { ScrollArea } from '@appica/ui-react/scroll-area'

export function BackupDialog({
  sessionId,
  isReadOnly,
  onClose,
  onRestored
}: {
  sessionId: string
  isReadOnly: boolean
  onClose: () => void
  onRestored: (opened: OpenProjectResult) => void
}) {
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

  useEffect(() => {
    void load()
  }, [load])

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

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent frame={false} className="flex flex-col max-h-[85vh] sm:max-w-2xl" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>项目备份管理</DialogTitle>
          <DialogDescription>
            使用 SQLite 在线备份 API 生成一致性副本，每项目轮换保留最近 5 份。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between border-b border-[#e5ddd3] pb-3 text-xs px-6">
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isReadOnly || creating} onClick={() => void createBackup()}>
              <HardDrive size={14} />
              {creating ? '正在创建备份...' : '立即备份'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void openLocation()}>
              <FolderOpen size={14} />
              打开目录
            </Button>
          </div>
          <span className="rounded-full bg-[#efe6da] px-2.5 py-1 text-[#7d6b59]">
            当前保留 <strong className="text-[#2c2523]">{backups.length}</strong> / 5 份备份
          </span>
        </div>

        {error && <p className="inline-error text-xs text-red-600 px-6">{error}</p>}

        {restoringPath && (
          <div className="mx-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <span>⚠️ 从该备份恢复将自动为当前状态创建「恢复前快照」并重载项目。确认恢复？</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRestoringPath(null)}>
                取消
              </Button>
              <Button size="sm" variant="destructive" onClick={() => void restore(restoringPath)}>
                确认恢复
              </Button>
            </div>
          </div>
        )}

        <div className="px-6">
          <ScrollArea className="h-64 rounded-xl border border-[#e5ddd3] bg-white p-2">
          {loading ? (
            <p className="p-8 text-center text-xs text-[#7d6b59]">加载备份列表中...</p>
          ) : backups.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#7d6b59]">
              暂无备份记录。点击上方「立即备份」创建首份一致性副本。
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-1">
              {backups.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded-lg border border-[#f0e8de] bg-[#faf8f5] p-3 text-xs"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {backupTagLabel[b.tag || ''] || b.tag || '备份'}
                      </Badge>
                      <strong className="text-xs text-[#2c2523]" title={b.id}>
                        {b.id}
                      </strong>
                    </div>
                    <span className="text-[11px] text-[#7d6b59]">
                      {formatDate(b.createdAt)} · {formatBytes(b.sizeBytes)}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isReadOnly}
                    className="text-[#2d6a4f] hover:text-[#24583e]"
                    onClick={() => setRestoringPath(b.path)}
                  >
                    <RotateCcw size={14} />
                    恢复
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
        </div>

        <DialogFooter className="flex items-center justify-between border-t border-[#e5ddd3] pt-3 text-[11px] text-[#7d6b59]">
          <span>达到 5 份上限后，系统在生成新备份时将自动循环覆盖最早的历史副本</span>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const BackupManagerDialog = BackupDialog
