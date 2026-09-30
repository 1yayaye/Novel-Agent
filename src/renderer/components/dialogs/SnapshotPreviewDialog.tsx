import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { ChapterSnapshotDetail } from '../../../shared/project'
import { snapshotKindLabel } from '../../utils/constants'
import { formatDate, count } from '../../utils/formatters'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Textarea } from '@appica/ui-react/textarea'

export function SnapshotPreviewDialog({
  snapshot,
  onClose,
  onRestore
}: {
  snapshot: ChapterSnapshotDetail
  onClose: () => void
  onRestore: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent frame={false} className="flex flex-col max-h-[85vh] sm:max-w-2xl" closeLabel="关闭">
        <DialogHeader>
          <div className="flex flex-col gap-1">
            <DialogTitle>{snapshot.name || snapshot.title}</DialogTitle>
            <DialogDescription className="flex items-center gap-2 pt-1">
              <Badge variant="secondary">
                {snapshotKindLabel[snapshot.snapshotKind] || snapshot.snapshotKind}
              </Badge>
              <span>
                v{snapshot.chapterVersion} · {formatDate(snapshot.createdAt)} · {count(snapshot.content)} 字
              </span>
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-[260px] max-h-[50vh] overflow-hidden rounded-xl border border-[#e5ddd3] bg-white p-3 mx-6">
          <Textarea
            readOnly
            value={snapshot.content}
            aria-label="快照内容"
            className="h-full w-full resize-none border-none bg-transparent font-serif text-sm leading-relaxed text-[#2c2523] outline-none shadow-none focus-visible:ring-0"
          />
        </div>

        {confirming && (
          <div className="mx-6 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <span>恢复快照将先备份当前正文并覆盖当前章节。是否继续？</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                取消
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={onRestore}>
                确认恢复
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            返回
          </Button>
          {!confirming && (
            <Button type="button" onClick={() => setConfirming(true)}>
              <RotateCcw size={15} />
              恢复此快照
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
