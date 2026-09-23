import { useState, useEffect } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { ModelConnectionSummary } from '../../../shared/project'
import { errorText } from '../../utils/formatters'
import { getEndpointHost, computeSha256Fingerprint } from '../../utils/crypto'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { Card } from '@appica/ui-react/card'

export function ContentTargetConfirmDialog({
  connection,
  onClose,
  onConfirmed
}: {
  connection: ModelConnectionSummary
  onClose: () => void
  onConfirmed: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fingerprint, setFingerprint] = useState('')

  const endpointHost = getEndpointHost(connection.baseUrl)

  useEffect(() => {
    void computeSha256Fingerprint(connection.baseUrl, connection.model).then(setFingerprint)
  }, [connection.baseUrl, connection.model])

  const handleConfirm = async () => {
    if (!fingerprint) return
    setSubmitting(true)
    setError('')
    try {
      await window.novelAgent.connection.confirmContentTarget({
        connectionId: connection.id,
        displayedFingerprint: fingerprint
      })
      onConfirmed()
    } catch (err) {
      setError(errorText(err, '确认联网目标失败'))
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="flex flex-col" closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>确认联网目标端点</DialogTitle>
          <DialogDescription>
            首次发送小说作品内容至该服务商前需由作者确认
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-xs">
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-800">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              执行创作、问答、知识分析等任务将把作品正文或世界观上下文发送至下列目标端点。确认后该端点将被信任；若端点或模型变更需重新确认。
            </span>
          </div>

          <Card className="flex flex-col gap-2 p-3 bg-white border-[#e5ddd3]">
            <div className="flex justify-between border-b border-[#f5efe6] pb-1.5">
              <strong className="text-[#7d6b59]">连接名称</strong>
              <span className="text-[#2c2523] font-medium">{connection.name}</span>
            </div>
            <div className="flex justify-between border-b border-[#f5efe6] pb-1.5">
              <strong className="text-[#7d6b59]">模型 ID</strong>
              <span className="font-mono text-[#2c2523]">{connection.model}</span>
            </div>
            <div className="flex justify-between border-b border-[#f5efe6] pb-1.5">
              <strong className="text-[#7d6b59]">目标主机</strong>
              <span className="font-medium text-[#2d6a4f]">{endpointHost}</span>
            </div>
            <div className="flex justify-between border-b border-[#f5efe6] pb-1.5">
              <strong className="text-[#7d6b59]">Base URL</strong>
              <span className="font-mono text-[#7d6b59] text-[11px] truncate max-w-[240px]">
                {connection.baseUrl}
              </span>
            </div>
            <div className="pt-1">
              <div className="text-[11px] text-[#7d6b59] mb-1">内容目标指纹 (Fingerprint)</div>
              <div className="break-all rounded bg-[#f5efe6] p-2 font-mono text-[11px] text-[#54473b]">
                {fingerprint || '计算中...'}
              </div>
            </div>
          </Card>

          {error && <p className="inline-error text-xs text-red-600">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={submitting || !fingerprint}
            onClick={() => void handleConfirm()}
          >
            <ShieldCheck size={15} />
            {submitting ? '确认中...' : '确认并信任该目标端点'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
