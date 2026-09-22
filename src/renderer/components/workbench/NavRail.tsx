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
  PanelLeftOpen,
  Pencil,
  Radio,
  Search,
  Sliders,
  Sparkles
} from 'lucide-react'
import type { ActiveDialog } from './Workbench'

interface NavRailProps {
  activeDialog: ActiveDialog
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
  isActive: (activeDialog: ActiveDialog) => boolean
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
  const isWritingActive = (dialog: ActiveDialog) => dialog === null

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
      className={`left-rail ${isExpanded ? 'expanded' : 'collapsed'}`}
      data-tour="left-rail"
      aria-label="功能导航栏"
    >
      <div className="nav-rail-header">
        <div className="nav-rail-brand">
          <div className="app-mark" title="Novel Agent">NA</div>
          {isExpanded && <span className="nav-rail-brand-name">Novel Agent</span>}
        </div>
        {isExpanded && (
          <button
            type="button"
            className="nav-rail-collapse-btn"
            onClick={onToggleExpanded}
            title="收起为紧凑图标栏"
            aria-label="收起导航栏"
          >
            <PanelLeftClose size={15} />
          </button>
        )}
      </div>

      {sections.map((section, secIdx) => (
        <div key={section.title} className="rail-group">
          {isExpanded ? (
            <div className="nav-rail-group-title">{section.title}</div>
          ) : (
            secIdx > 0 && <div className="rail-divider" />
          )}

          {section.items.map((item) => {
            const Icon = item.icon
            const active = item.isActive(activeDialog)
            return (
              <button
                key={item.id}
                type="button"
                className={`left-rail-btn ${active ? 'rail-active' : ''}`}
                title={item.title}
                aria-label={item.label}
                onClick={() => onSelectAction(item.id)}
              >
                <Icon size={isExpanded ? 15 : 16} />
                {isExpanded ? (
                  <span>{item.label}</span>
                ) : (
                  <span className="rail-mini-label">{item.miniLabel}</span>
                )}
              </button>
            )
          })}
        </div>
      ))}

      <div className="nav-rail-footer">
        <button
          type="button"
          className="nav-rail-toggle-btn"
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
