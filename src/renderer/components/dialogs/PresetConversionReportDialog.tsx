import React from 'react'
import type { PresetConversionReport } from '../../../shared/prompt-settings.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@appica/ui-react/dialog'
import { Button } from '@appica/ui-react/button'
import { PresetConversionReportView } from './PresetConversionReportView.js'

export interface PresetConversionReportDialogProps {
  open: boolean
  onClose: () => void
  presetName: string
  report: PresetConversionReport
}

export function PresetConversionReportDialog({
  open,
  onClose,
  presetName,
  report
}: PresetConversionReportDialogProps) {
  if (!open) return null

  return (
    <Dialog open onOpenChange={(val) => { if (!val) onClose() }}>
      <DialogContent
        frame={false}
        closeLabel="关闭报告"
        className="flex flex-col w-[90vw] max-w-4xl h-[85vh] overflow-hidden bg-[#faf8f5] text-[#2c2523] border border-[#dacdbe] rounded-2xl shadow-2xl"
      >
        <DialogHeader className="px-5 py-3.5 border-b border-[#e5ddd3] bg-[#f7f2ea]">
          <DialogTitle className="text-base font-bold text-[#2c2523] flex items-center gap-2">
            <span>AI 预设转换兼容性报告</span>
            <span className="text-xs font-normal text-[#7d6b59]">（预设：{presetName}）</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-[#7d6b59] mt-0.5">
            审查 SillyTavern 提示词、脚本与正则转换至本地静态 Prompt 块的详细处置结论与损失说明。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 p-5 overflow-hidden flex flex-col">
          <PresetConversionReportView report={report} className="flex-1 min-h-0 flex flex-col" />
        </div>

        <DialogFooter className="px-5 py-3 border-t border-[#e5ddd3] bg-[#f7f2ea] flex items-center justify-end">
          <Button size="sm" onClick={onClose} className="bg-[#2d6a4f] text-white hover:bg-[#23533e] text-xs">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
