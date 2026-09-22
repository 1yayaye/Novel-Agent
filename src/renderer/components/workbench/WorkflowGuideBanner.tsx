import { useState } from 'react'
import { FileBarChart, Sparkles, X, ArrowRight } from 'lucide-react'

interface WorkflowGuideBannerProps {
  totalChapters: number
  summaryCount: number
  reportCount: number
  isReadOnly?: boolean
  onStartKnowledgeAnalysis: () => void
  onStartReportAnalysis: () => void
}

export function WorkflowGuideBanner({
  totalChapters,
  summaryCount,
  reportCount,
  isReadOnly = false,
  onStartKnowledgeAnalysis,
  onStartReportAnalysis
}: WorkflowGuideBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  // Only show when there are chapters but lack initial analysis
  if (dismissed || totalChapters === 0 || (summaryCount > 0 && reportCount > 0)) {
    return null
  }

  const needsKnowledge = summaryCount === 0
  const needsReport = reportCount === 0

  return (
    <div className="workflow-guide-banner" role="status" aria-label="新小说冷启动分析指引">
      <div className="workflow-guide-content">
        <div className="workflow-guide-icon-badge">
          <Sparkles size={18} />
        </div>
        <div className="workflow-guide-texts">
          <div className="workflow-guide-title">
            <span>新小说导入就绪 · 建议先完成核心分析</span>
            {needsKnowledge && needsReport && (
              <span style={{ fontSize: 11, background: 'rgba(45, 90, 39, 0.12)', color: '#2d5a27', padding: '1px 6px', borderRadius: 10, fontWeight: 500 }}>
                未初始化
              </span>
            )}
          </div>
          <div className="workflow-guide-steps" title="推荐流程：文风分析 ➔ 剧情与设定抽取 ➔ 自动全书大纲">
            当前共有 <strong>{totalChapters}</strong> 章正文。完成分析后，将自动提取人物设定与章节摘要，并生成全书大纲。
          </div>
        </div>
      </div>

      <div className="workflow-guide-actions">
        {needsKnowledge && (
          <button
            type="button"
            className="workflow-guide-primary-btn"
            disabled={isReadOnly}
            onClick={onStartKnowledgeAnalysis}
            title="逐章提取剧情摘要、人物世界观设定，并自动生成全书宏观大纲草稿"
          >
            <Sparkles size={13} />
            <span>一键提取剧情与大纲</span>
            <ArrowRight size={12} />
          </button>
        )}

        {needsReport && (
          <button
            type="button"
            className="workflow-guide-sub-btn"
            disabled={isReadOnly}
            onClick={onStartReportAnalysis}
            title="生成六大维度文学分析报告（视角、语言文风、叙事节奏等）"
          >
            <FileBarChart size={13} />
            <span>分析文风报告</span>
          </button>
        )}

        <button
          type="button"
          className="workflow-guide-dismiss-btn"
          onClick={() => setDismissed(true)}
          title="暂时收起提示"
          aria-label="关闭提示"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}
