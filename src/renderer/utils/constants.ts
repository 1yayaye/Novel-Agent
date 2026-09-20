import type {
  ConsistencyIssueSeverity,
  ConsistencyIssueState,
  ConsistencyIssueType,
  KnowledgeKind,
  ReportSectionType,
  SuggestionState,
  TaskType
} from '../../shared/project'
import type { SaveState } from '../types/editor'

export const stateLabel: Record<SaveState, string> = { saved: '已保存', dirty: '未保存', saving: '保存中', error: '保存失败', conflict: '版本冲突', read_only: '只读' }

export const sourceLabel: Record<string, string> = {
  chapter_chunk: '章节正文',
  creative_rules: '创作规则',
  style_sample: '风格样本',
  knowledge_entry: '知识条目'
}

export const snapshotKindLabel: Record<string, string> = {
  ordinary: '普通',
  manual: '手动',
  split: '拆分前',
  merge: '合并前',
  restore: '恢复前',
  ai_apply: 'AI写回'
}

export const backupTagLabel: Record<string, string> = {
  auto: '每日自动',
  manual: '手动',
  split: '拆分前',
  merge: '合并前',
  'pre-restore': '恢复前'
}

export const knowledgeKindLabel: Record<KnowledgeKind, string> = {
  character: '人物',
  world: '世界观',
  timeline: '时间线',
  foreshadow: '伏笔'
}

export const foreshadowStateLabel: Record<string, string> = {
  planted: '铺设中',
  developing: '发展中',
  resolved: '已揭示',
  abandoned: '已废弃'
}

export const taskTypeLabel: Record<string, string> = {
  continue: '续写',
  rewrite: '重写',
  polish: '润色',
  knowledge: '知识分析',
  report: '文学报告',
  chat: '项目问答'
}

export const suggestionStateLabel: Record<SuggestionState, string> = {
  pending: '待审阅',
  accepted: '已采纳',
  ignored: '已忽略',
  conflict: '存在冲突'
}

export const consistencyIssueTypeLabel: Record<ConsistencyIssueType, string> = {
  plot_hole: '剧情漏洞',
  character_inconsistency: '人物矛盾',
  timeline_contradiction: '时间线冲突',
  setting_mismatch: '设定偏差',
  style_drift: '文风漂移',
  other: '其他'
}

export const consistencySeverityLabel: Record<ConsistencyIssueSeverity, string> = {
  high: '严重',
  medium: '中等',
  low: '轻微'
}

export const consistencyStateLabel: Record<ConsistencyIssueState, string> = {
  open: '待处理',
  acknowledged: '已确认',
  dismissed: '已忽略',
  stale: '已过时'
}

export const reportSectionTitle: Record<ReportSectionType, string> = {
  theme: '主题思想',
  narrative_perspective: '叙事视角',
  style: '语言文风',
  pacing_and_structure: '节奏与结构',
  character_arc: '人物成长与弧光',
  continuity_issues: '连续性与逻辑问题'
}

export const taskStateLabel: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断'
}

export const taskTypeLabels: Record<TaskType, { title: string; desc: string }> = {
  continue: { title: '小说续写', desc: '根据上文情境及创作规则延续正文' },
  rewrite: { title: '定向重写', desc: '根据指令或风格样本重构选区或章节' },
  polish: { title: '文字润色', desc: '修正病句、错别字，优化修辞与文笔' },
  knowledge: { title: '知识提取与分析', desc: '从正文中提取人物设定、地点事实建议' },
  report: { title: '文学与剧情报告', desc: '生成全书/分卷剧情大纲、伏笔与人物弧光报告' },
  chat: { title: '项目设定问答', desc: '针对小说世界观与设定进行自由探讨与推演' }
}
