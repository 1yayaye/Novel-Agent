import React from 'react'
import {
  AlertTriangle,
  Archive,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileBarChart,
  FileDown,
  GitCompare,
  ListOrdered,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Radio,
  Search,
  Sliders,
  Sparkles
} from 'lucide-react'

export type ActiveNavDialog = string | null

export interface NavRailProps {
  activeDialog: ActiveNavDialog
  isExpanded: boolean
  onToggleExpanded: () => void
  onSelectAction: (actionKey: string) => void
}

interface NavItem {
  id: string
  label: string
  miniLabel: string
  icon: typeof Pencil
  title: string
  isActive: (activeDialog: ActiveNavDialog) => boolean
}

interface NavSection {
  title: string
  items: NavItem[]
}

export function NavRail({
  activeDialog,
  isExpanded,
  onToggleExpanded,
  onSelectAction
}: NavRailProps) {
  const isWritingActive = (dialog: ActiveNavDialog) => dialog === null

  const sections: NavSection[] = [
    {
      title: '创作中心',
      items: [
        {
          id: 'write',
          label: '正文写作',
          miniLabel: '写作',
          icon: Pencil,
          title: '章节编辑器 (回到正文)',
          isActive: (d) => isWritingActive(d)
        },
        {
          id: 'chat',
          label: '创作与问答',
          miniLabel: '问答',
          icon: MessageSquare,
          title: '项目问答与多轮创作研讨',
          isActive: (d) => d === 'chat'
        },
        {
          id: 'candidateReview',
          label: '差异审阅',
          miniLabel: '审阅',
          icon: GitCompare,
          title: 'AI 创作候选比对与写回正文',
          isActive: (d) => d === 'candidateReview'
        }
      ]
    },
    {
      title: '大纲脉络',
      items: [
        {
          id: 'outline',
          label: '大纲与故事脉络',
          miniLabel: '大纲',
          icon: Compass,
          title: '整合全书、分卷、章大纲与滚动故事脉络',
          isActive: (d) => d === 'outline' || d === 'synopsis'
        }
      ]
    },
    {
      title: '设定与分析',
      items: [
        {
          id: 'knowledge',
          label: '人物与设定库',
          miniLabel: '设定',
          icon: BookOpen,
          title: '知识库管理 (人物、世界观事实)',
          isActive: (d) => d === 'knowledge'
        },
        {
          id: 'reports',
          label: '文学文风报告',
          miniLabel: '文风',
          icon: FileBarChart,
          title: '六维度文学特征与文风深度分析',
          isActive: (d) => d === 'reports'
        },
        {
          id: 'consistency',
          label: '逻辑一致性',
          miniLabel: '质检',
          icon: AlertTriangle,
          title: '剧情矛盾与时间线一致性检测',
          isActive: (d) => d === 'consistency'
        },
        {
          id: 'suggestions',
          label: '设定事实建议',
          miniLabel: '建议',
          icon: Sparkles,
          title: 'AI 建议审阅 (待确认的设定事实)',
          isActive: (d) => d === 'suggestions'
        },
        {
          id: 'tasks',
          label: '任务执行中心',
          miniLabel: '任务',
          icon: ListOrdered,
          title: '后台异步任务队列与状态',
          isActive: (d) => d === 'tasks'
        }
      ]
    },
    {
      title: '工具与配置',
      items: [
        {
          id: 'connection',
          label: '模型连接配置',
          miniLabel: '模型',
          icon: Radio,
          title: '大模型连接、任务路由与隐私门禁',
          isActive: (d) => d === 'connection'
        },
        {
          id: 'creative',
          label: '创作规则与文风',
          miniLabel: '规则',
          icon: Sliders,
          title: '文风样本、提示词预设与创作控制规则',
          isActive: (d) => d === 'creative'
        },
        {
          id: 'search',
          label: '全文深度检索',
          miniLabel: '搜索',
          icon: Search,
          title: '全文与向量混合搜索 (Ctrl+Shift+F)',
          isActive: (d) => d === 'search'
        },
        {
          id: 'backup',
          label: '快照与备份',
          miniLabel: '备份',
          icon: Archive,
          title: '项目备份与历史快照管理',
          isActive: (d) => d === 'backup'
        },
        {
          id: 'export',
          label: '导出作品文档',
          miniLabel: '导出',
          icon: FileDown,
          title: '导出为 TXT / Markdown / EPUB',
          isActive: (d) => d === 'export'
        }
      ]
    }
  ]

  return (
    <aside
      className={`left-rail ${isExpanded ? 'expanded' : 'collapsed'} flex flex-col h-full bg-[#faf8f5] border-r border-[#e5ddd3] transition-all duration-200 select-none z-20 ${
        isExpanded ? 'w-56' : 'w-16'
      }`}
      data-tour="left-rail"
      aria-label="功能导航栏"
    >
      {/* Brand Header */}
      <div className="nav-rail-header flex items-center justify-between p-3 border-b border-[#e5ddd3]">
        <div className="nav-rail-brand flex items-center gap-2.5 overflow-hidden">
          <div
            className="app-mark w-8 h-8 rounded-xl bg-[#2d6a4f] text-white flex items-center justify-center font-bold text-xs tracking-wider shrink-0 shadow-sm"
            title="Novel Agent"
          >
            NA
          </div>
          {isExpanded && (
            <span className="nav-rail-brand-name font-bold text-xs text-[#2c2523] truncate font-serif">
              Novel Agent
            </span>
          )}
        </div>
        {isExpanded && (
          <button
            type="button"
            className="nav-rail-collapse-btn p-1 text-[#7d6b59] hover:text-[#2c2523] hover:bg-[#efe6da] rounded-lg transition-colors"
            onClick={onToggleExpanded}
            title="收起为紧凑图标栏"
            aria-label="收起导航栏"
          >
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>

      {/* Nav groups */}
      <div className="flex-1 overflow-y-auto py-2 px-1.5 space-y-3">
        {sections.map((section, secIdx) => (
          <div key={section.title} className="rail-group space-y-0.5">
            {isExpanded ? (
              <div className="nav-rail-group-title px-2.5 py-1 text-[11px] font-semibold text-[#877d74] uppercase tracking-wider">
                {section.title}
              </div>
            ) : (
              secIdx > 0 && <div className="rail-divider my-2 border-t border-[#e5ddd3]/60 mx-1" />
            )}

            {section.items.map((item) => {
              const Icon = item.icon
              const active = item.isActive(activeDialog)
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`left-rail-btn w-full flex items-center rounded-xl text-xs font-medium transition-colors ${
                    isExpanded ? 'gap-2.5 px-3 py-2 text-left' : 'flex-col gap-1 py-2 px-1 items-center justify-center'
                  } ${
                    active
                      ? 'rail-active bg-[#2d6a4f] text-white shadow-sm'
                      : 'text-[#54473b] hover:bg-[#efe6da] hover:text-[#2c2523]'
                  }`}
                  title={item.title}
                  aria-label={item.label}
                  onClick={() => onSelectAction(item.id)}
                >
                  <Icon size={isExpanded ? 15 : 17} className={active ? 'text-white' : 'text-[#7d6b59]'} />
                  {isExpanded ? (
                    <span className="truncate">{item.label}</span>
                  ) : (
                    <span className="rail-mini-label text-[10px] tracking-tight leading-none">
                      {item.miniLabel}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* Footer toggle */}
      <div className="nav-rail-footer p-2 border-t border-[#e5ddd3]">
        <button
          type="button"
          className="nav-rail-toggle-btn w-full flex items-center justify-center gap-2 p-1.5 text-xs text-[#7d6b59] hover:text-[#2c2523] hover:bg-[#efe6da] rounded-xl transition-colors"
          onClick={onToggleExpanded}
          title={isExpanded ? '收起侧边栏' : '展开侧边栏 (显示中文标签)'}
          aria-label={isExpanded ? '收起导航栏' : '展开导航栏'}
        >
          {isExpanded ? (
            <>
              <ChevronLeft size={14} />
              <span>收起导航</span>
            </>
          ) : (
            <ChevronRight size={14} />
          )}
        </button>
      </div>
    </aside>
  )
}
