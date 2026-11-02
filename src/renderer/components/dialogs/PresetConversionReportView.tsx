import React, { useState, useMemo } from 'react'
import type { PresetConversionReport } from '../../../shared/prompt-settings.js'
import { Badge } from '@appica/ui-react/badge'
import { Card } from '@appica/ui-react/card'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import { AlertCircle, ExternalLink, Cpu, Layers, FileCode, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'

export interface PresetConversionReportViewProps {
  report: PresetConversionReport
  className?: string
}

const KIND_LABELS: Record<string, string> = {
  prompt: '提示词',
  order: '排序',
  script: '脚本',
  regex: '正则',
  extension: '扩展',
  settings: '设置'
}

const DISPOSITION_CONFIG: Record<
  string,
  { label: string; badgeClass: string; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  retained: {
    label: '保留',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    icon: CheckCircle2
  },
  adapted: {
    label: '改写',
    badgeClass: 'bg-blue-50 text-blue-800 border-blue-200',
    icon: Info
  },
  ignored: {
    label: '忽略',
    badgeClass: 'bg-stone-100 text-stone-700 border-stone-200',
    icon: XCircle
  },
  unsupported: {
    label: '不支持',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: AlertTriangle
  }
}

export function PresetConversionReportView({ report, className = '' }: PresetConversionReportViewProps) {
  const [filterDisposition, setFilterDisposition] = useState<'all' | 'retained' | 'adapted' | 'ignored' | 'unsupported'>('all')
  const [filterKind, setFilterKind] = useState<string>('all')

  const counts = useMemo(() => {
    const c = { retained: 0, adapted: 0, ignored: 0, unsupported: 0 }
    for (const item of report.items) {
      if (item.disposition in c) {
        c[item.disposition as keyof typeof c]++
      }
    }
    return c
  }, [report.items])

  const filteredItems = useMemo(() => {
    return report.items.filter((item) => {
      if (filterDisposition !== 'all' && item.disposition !== filterDisposition) return false
      if (filterKind !== 'all' && item.kind !== filterKind) return false
      return true
    })
  }, [report.items, filterDisposition, filterKind])

  return (
    <div className={`space-y-4 text-xs ${className}`}>
      {/* 概览指标 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Card className="p-3 bg-white border-[#dacdbe] rounded-xl flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-[#7d6b59] mb-1">
            <Cpu size={13} />
            <span className="font-semibold">转换模型</span>
          </div>
          <div className="text-sm font-bold text-[#2c2523] truncate" title={`${report.model.name} (${report.model.model})`}>
            {report.model.name}
          </div>
          <span className="text-[10px] text-[#7d6b59] truncate font-mono mt-0.5">{report.model.model}</span>
        </Card>

        <Card className="p-3 bg-white border-[#dacdbe] rounded-xl flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-[#7d6b59] mb-1">
            <Layers size={13} />
            <span className="font-semibold">来源条目</span>
          </div>
          <div className="text-sm font-bold text-[#2c2523]">{report.items.length} 个条目</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[10px] text-emerald-700">保留 {counts.retained}</span>
            <span className="text-[10px] text-[#dacdbe]">·</span>
            <span className="text-[10px] text-blue-700">改写 {counts.adapted}</span>
            <span className="text-[10px] text-[#dacdbe]">·</span>
            <span className="text-[10px] text-stone-500">略过 {counts.ignored + counts.unsupported}</span>
          </div>
        </Card>

        <Card className="p-3 bg-white border-[#dacdbe] rounded-xl flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-[#7d6b59] mb-1">
            <FileCode size={13} />
            <span className="font-semibold">Token 消耗</span>
          </div>
          <div className="text-sm font-bold text-[#2c2523]">
            {report.usage.totalTokens.toLocaleString()}
          </div>
          <span className="text-[10px] text-[#7d6b59] mt-0.5">
            输入 {report.usage.promptTokens.toLocaleString()} / 输出 {report.usage.completionTokens.toLocaleString()}
          </span>
        </Card>

        <Card className="p-3 bg-white border-[#dacdbe] rounded-xl flex flex-col justify-between">
          <div className="flex items-center gap-1.5 text-[#7d6b59] mb-1">
            <Layers size={13} />
            <span className="font-semibold">逻辑请求数</span>
          </div>
          <div className="text-sm font-bold text-[#2c2523]">{report.usage.requests} 次</div>
          <span className="text-[10px] text-[#7d6b59] mt-0.5">
            返回 Usage: {report.usage.reportedRequests} 次
          </span>
        </Card>
      </div>

      {/* 警告列表 */}
      {report.warnings.length > 0 && (
        <div className="space-y-1.5">
          {report.warnings.map((w, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-[11px]"
            >
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-600" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* 规范参考 */}
      {report.references && report.references.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-[#f7f2ea] border border-[#e5ddd3] text-[11px] text-[#7d6b59]">
          <span className="font-semibold text-[#54473b]">参考规范版本 {report.referenceVersion}：</span>
          {report.references.map((ref) => (
            <a
              key={ref.name}
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[#2d6a4f] hover:underline"
            >
              <span>{ref.name} ({ref.revision.slice(0, 7)})</span>
              <ExternalLink size={10} />
            </a>
          ))}
        </div>
      )}

      {/* 过滤筛选条 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5ddd3] pb-2">
        <div className="flex items-center gap-1">
          {(['all', 'retained', 'adapted', 'ignored', 'unsupported'] as const).map((disp) => {
            const count = disp === 'all' ? report.items.length : counts[disp]
            const active = filterDisposition === disp
            return (
              <button
                key={disp}
                type="button"
                onClick={() => setFilterDisposition(disp)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-[#2d6a4f] text-white shadow-xs'
                    : 'bg-white text-[#54473b] border border-[#dacdbe] hover:bg-[#f7f2ea]'
                }`}
              >
                {disp === 'all' ? `全部 (${count})` : `${DISPOSITION_CONFIG[disp]?.label} (${count})`}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-[#7d6b59]">
          <span>类型：</span>
          <select
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value)}
            className="px-2 py-0.5 rounded border border-[#dacdbe] bg-white text-xs text-[#2c2523]"
          >
            <option value="all">全部类型</option>
            <option value="prompt">提示词</option>
            <option value="order">排序</option>
            <option value="script">脚本</option>
            <option value="regex">正则</option>
            <option value="extension">扩展</option>
            <option value="settings">设置</option>
          </select>
        </div>
      </div>

      {/* 条目明细列表 */}
      <ScrollArea className="h-64 sm:h-80 pr-2">
        <div className="space-y-2">
          {filteredItems.length === 0 ? (
            <div className="p-6 text-center text-[#7d6b59] bg-white rounded-lg border border-[#e5ddd3]">
              没有符合当前筛选条件的来源条目
            </div>
          ) : (
            filteredItems.map((item) => {
              const cfg = DISPOSITION_CONFIG[item.disposition] || DISPOSITION_CONFIG.retained
              const IconComp = cfg.icon
              return (
                <Card
                  key={item.sourceId}
                  className="p-3 bg-white border-[#dacdbe] rounded-lg space-y-2 hover:border-[#2d6a4f]/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <IconComp size={14} className="shrink-0 text-[#7d6b59]" />
                      <span className="font-semibold text-[#2c2523] truncate">{item.name || '(未命名)'}</span>
                      <span className="text-[10px] font-mono text-[#7d6b59] truncate bg-[#faf8f5] px-1.5 py-0.5 rounded border border-[#e5ddd3]">
                        {item.path}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="text-[10px]">
                        {KIND_LABELS[item.kind] || item.kind}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${cfg.badgeClass}`}>
                        {cfg.label}
                      </Badge>
                    </div>
                  </div>

                  {item.reason && (
                    <div className="text-[11px] text-[#54473b] leading-relaxed bg-[#faf8f5] p-2 rounded border border-[#e5ddd3]">
                      <span className="font-semibold text-[#2c2523]">处理说明：</span>
                      {item.reason}
                    </div>
                  )}

                  {item.losses && item.losses.length > 0 && (
                    <div className="p-2 rounded bg-amber-50/60 border border-amber-200/80 text-[11px] text-amber-900 space-y-1">
                      <div className="font-semibold flex items-center gap-1 text-amber-800">
                        <AlertTriangle size={12} />
                        <span>转换损失 / 降级项：</span>
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[10.5px]">
                        {item.losses.map((loss, lIdx) => (
                          <li key={lIdx}>{loss}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {item.targetBlockIds && item.targetBlockIds.length > 0 && (
                    <div className="text-[10px] text-[#7d6b59]">
                      映射目标 Block 数量：<span className="font-semibold text-[#2c2523]">{item.targetBlockIds.length}</span>
                    </div>
                  )}
                </Card>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
