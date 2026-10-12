export const PRESET_ROLE_OPTIONS = [
  { value: 'system', label: 'System (系统)' },
  { value: 'user', label: 'User (作者)' },
  { value: 'assistant', label: 'Assistant (助手)' }
] as const

export const PRESET_MARKER_OPTIONS = [
  { value: 'none', label: '普通提示词 (静态内容)' },
  { value: 'marker.knowledge', label: '设定库资料插槽 (知识库)' },
  { value: 'marker.outlines', label: '大纲插槽 (全书/分卷/本章)' },
  { value: 'marker.project_rules', label: '全书准则插槽' },
  { value: 'marker.target', label: '目标章节正文插槽' },
  { value: 'marker.history', label: '正文与会话历史插槽' },
  { value: 'marker.task', label: '本次作者任务插槽' },
  { value: 'marker.style_samples', label: '文风样本插槽' }
] as const

export const PRESET_POSITION_OPTIONS = [
  { value: 'relative', label: '标准相对顺序' },
  { value: 'in_chat', label: '会话深度注入 (In-Chat)' }
] as const
