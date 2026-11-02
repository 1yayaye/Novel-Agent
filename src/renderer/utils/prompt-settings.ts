import { PROMPT_MARKERS } from '../../shared/prompt-settings'

export const PRESET_ROLE_OPTIONS = [
  { value: 'system', label: 'System (系统)' },
  { value: 'user', label: 'User (作者)' },
  { value: 'assistant', label: 'Assistant (助手)' }
] as const

// 插槽值从 shared 的唯一清单派生，标签只管展示——新增插槽改 shared 一处即可
const MARKER_LABELS: Record<(typeof PROMPT_MARKERS)[number], string> = {
  project_rules: '全书准则插槽',
  outlines: '大纲插槽 (全书/分卷/本章)',
  knowledge: '设定库资料插槽 (知识库)',
  synopsis: '故事梗概插槽',
  style_samples: '文风样本插槽',
  references: '参考资料插槽',
  suggestions: '创作建议插槽',
  preset: '活动预设插槽',
  target: '目标章节正文插槽',
  history: '正文与会话历史插槽',
  task: '本次作者任务插槽'
}

export const PRESET_MARKER_OPTIONS = [
  { value: 'none', label: '普通提示词 (静态内容)' },
  ...PROMPT_MARKERS.map((marker) => ({ value: `marker.${marker}` as const, label: MARKER_LABELS[marker] }))
] as const

export const PRESET_POSITION_OPTIONS = [
  { value: 'relative', label: '标准相对顺序' },
  { value: 'in_chat', label: '会话深度注入 (In-Chat)' }
] as const
