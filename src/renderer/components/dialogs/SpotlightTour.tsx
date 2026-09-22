import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence, usePresence } from 'motion/react'
import {
  Radio,
  BookOpen,
  Pencil,
  Sparkles,
  Layers,
  Archive,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Compass,
  Lightbulb,
  MessageSquare,
  Eye
} from 'lucide-react'

export type TourSceneDialog = 'connection' | 'context' | 'outline' | 'chat' | 'knowledge' | null

export interface TourStep {
  id: string
  targetSelector: string
  title: string
  subtitle?: string
  content: string
  tip?: string
  icon: React.ReactNode
  placement: 'bottom' | 'top' | 'right' | 'left' | 'center'
  sceneDialog?: TourSceneDialog
}

export const DEFAULT_TOUR_STEPS: TourStep[] = [
  {
    id: 'connection-scene',
    targetSelector: '.connection-dialog, [data-tour="connection-badge"]',
    title: '1. 配置大模型连接与任务路由',
    subtitle: '开启 AI 智能创作引擎',
    content:
      '【实景演示：模型配置】\n已自动为您调出模型管理面板。\n您可以在此添加 OpenAI、DeepSeek、SiliconFlow 或本地 Ollama 模型接口，并为续写、重写、项目问答、知识分析等不同任务分别指派最优模型与数据隐私确认。',
    tip: '未配置模型时，本地编辑、搜索、大纲与备份功能仍完全可用。',
    icon: <Radio size={20} className="tour-step-icon" />,
    placement: 'bottom',
    sceneDialog: 'connection'
  },
  {
    id: 'chapter-scene',
    targetSelector: '[data-tour="chapter-panel"]',
    title: '2. 章节目录与多卷结构',
    subtitle: '清晰管理全书篇章架构',
    content:
      '【实景演示：章节管理】\n回到工作台主界面。导入的作品全部章节在此清晰排布。\n您可以点击任意章节快速切换阅读与编辑，点击「+」新建章节，并在右侧检查器中进行重命名、上下排序、分章与合并。',
    tip: '支持长篇小说多卷分层规划，结构井然有序。',
    icon: <BookOpen size={20} className="tour-step-icon" />,
    placement: 'right',
    sceneDialog: null
  },
  {
    id: 'editor-scene',
    targetSelector: '[data-tour="editor-area"]',
    title: '3. 沉浸式正文编辑区',
    subtitle: '本地优先、极速流畅的写作中心',
    content:
      '【实景演示：正文编辑】\n高性能纯文本编辑器，正文实时自动保存，杜绝丢稿。\n支持段落缩进规范排版、字数统计，划选中正文字句可呼出 AI 浮动快捷菜单，工具栏右上角可一键开启全屏「禅模式」排除干扰。',
    tip: '编辑器完全基于本地存储，即使断网也能顺畅写作。',
    icon: <Pencil size={20} className="tour-step-icon" />,
    placement: 'top',
    sceneDialog: null
  },
  {
    id: 'context-scene',
    targetSelector: '.context-preview-dialog, [data-tour="ai-actions"]',
    title: '4. 透明上下文装配与 Token 预算',
    subtitle: 'AI 创作前拒绝黑盒，每一分 Token 清清楚楚',
    content:
      '【实景演示：上下文装配】\n已自动为您调出 AI 上下文装配预览。\n每次发起 AI 续写/重写/润色前，系统会自动装配当前章节、前情摘要、知识库设定与创作风格，并精确计算 Token 预算与裁剪策略，由您预览确认后才发送。',
    tip: 'AI 生成结果仅作为候选草稿保存在后台，绝不直接破坏正文。',
    icon: <Layers size={20} className="tour-step-icon" />,
    placement: 'bottom',
    sceneDialog: 'context'
  },
  {
    id: 'outline-scene',
    targetSelector: '.synopsis-dialog, [data-tour="left-rail"]',
    title: '5. 三层项目大纲规划',
    subtitle: '全书、分卷与章节大纲层级设计',
    content:
      '【实景演示：项目大纲】\n已自动为您打开大纲编辑器。\n提供「全书总纲」、「分卷大纲」和「章节细纲」三层体系。清晰的大纲能够作为 AI 创作的强力上下文约束，确保剧情主线不偏离、伏笔准时回收。',
    tip: '章大纲支持保存为草稿或确认状态，精准把控写作节奏。',
    icon: <Compass size={20} className="tour-step-icon" />,
    placement: 'bottom',
    sceneDialog: 'outline'
  },
  {
    id: 'chat-scene',
    targetSelector: '.chat-dialog, [data-tour="left-rail"]',
    title: '6. 项目多轮问答与剧情推演',
    subtitle: '全书 RAG 混合向量检索知识伴侣',
    content:
      '【实景演示：项目问答】\n已自动为您打开项目问答界面。\n基于全书文本和设定库的高性能混合检索（FTS5 + 向量检索），您可以随时向 AI 提问小说世界观、梳理人物关系或讨论后续剧情脑洞，回答均带有原文证据追溯。',
    tip: '长会话可一键压缩为结构化会话摘要，沉淀创作灵感。',
    icon: <MessageSquare size={20} className="tour-step-icon" />,
    placement: 'bottom',
    sceneDialog: 'chat'
  },
  {
    id: 'knowledge-scene',
    targetSelector: '.knowledge-dialog, [data-tour="left-rail"]',
    title: '7. 知识库与长记忆管理',
    subtitle: '人物、世界观、时间线与伏笔追踪',
    content:
      '【实景演示：作品知识库】\n已自动为您打开知识库管理。\n集中管理人物档案、势力设定、时间线与伏笔线索。导入小说后，您也可以一键发起「知识抽取」，让 AI 自动从正文中提炼实体并在此审阅采纳。',
    tip: '支持人物双向关系网与伏笔状态（已埋下/推进中/已回收）跟踪。',
    icon: <BookOpen size={20} className="tour-step-icon" />,
    placement: 'bottom',
    sceneDialog: 'knowledge'
  },
  {
    id: 'inspector-scene',
    targetSelector: '[data-tour="inspector-panel"]',
    title: '8. 版本快照与安全回滚',
    subtitle: '每一次灵感都有迹可循，创作绝无后顾之忧',
    content:
      '【实景演示：版本快照】\n回到工作台右侧检查器。\n作品全量保存在本地 SQLite 单文件 (.novelproj) 中。正文改动和 AI 采纳均会生成不可变版本快照，随时可一键比对与安全回滚。',
    tip: '作品以单文件 SQLite 格式保存于本机，可随时打包带走。',
    icon: <Archive size={20} className="tour-step-icon" />,
    placement: 'left',
    sceneDialog: null
  },
  {
    id: 'finish-scene',
    targetSelector: '[data-tour="left-rail"]',
    title: '🎉 沉浸式实景演示完成！',
    subtitle: '您已掌握 Novel Agent 的完整创作闭环',
    content:
      '您已完整体验从模型配置、章节排版、大纲问答、上下文装配到知识库与安全快照的全套工作流！\n现在，开始谱写您的精彩故事吧！随时可点击顶部或侧边的「❓使用指引」重新体验本演示。',
    tip: '点击下方「完成探索」即可关闭指引，尽情创作。',
    icon: <Sparkles size={20} className="tour-step-icon" />,
    placement: 'right',
    sceneDialog: null
  }
]

interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}

export function SpotlightTour({
  isOpen,
  steps = DEFAULT_TOUR_STEPS,
  onClose,
  onStepChange,
  storageKey = 'novel-agent-tour-completed'
}: {
  isOpen: boolean
  steps?: TourStep[]
  onClose: () => void
  onStepChange?: (index: number, step: TourStep) => void
  storageKey?: string
}) {
  const [isPresent, safeToRemove] = usePresence()
  const active = isOpen && isPresent
  const [currentIndex, setCurrentIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)

  const currentStep = steps[currentIndex]

  // Notify parent on step change for automated real-scene dialog opening/closing
  useEffect(() => {
    if (active && currentStep) {
      onStepChange?.(currentIndex, currentStep)
    }
  }, [active, currentIndex, currentStep, onStepChange])

  // Update target rect based on current step selector
  const updateRect = useCallback(() => {
    if (!currentStep) return

    const selectors = currentStep.targetSelector.split(',').map((s) => s.trim())
    let targetEl: Element | null = null

    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el) {
        targetEl = el
        break
      }
    }

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      const padding = 6

      const computedRect: SpotlightRect = {
        top: Math.max(0, rect.top - padding),
        left: Math.max(0, rect.left - padding),
        width: Math.min(window.innerWidth, rect.width + padding * 2),
        height: Math.min(window.innerHeight, rect.height + padding * 2)
      }
      setTargetRect(computedRect)
    } else {
      // Fallback to screen center
      setTargetRect({
        top: Math.max(20, window.innerHeight / 2 - 120),
        left: Math.max(20, window.innerWidth / 2 - 200),
        width: Math.min(400, window.innerWidth - 40),
        height: 240
      })
    }
  }, [currentStep])

  // Recalculate tooltip position based on target rect and preferred placement
  useEffect(() => {
    if (!targetRect || !currentStep) return

    const tooltipWidth = 440
    const tooltipHeight = 290
    const gap = 16
    const margin = 20

    let top = 0
    let left = 0

    const { placement } = currentStep

    if (placement === 'bottom') {
      top = targetRect.top + targetRect.height + gap
      left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2
    } else if (placement === 'top') {
      top = targetRect.top - tooltipHeight - gap
      left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2
    } else if (placement === 'right') {
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2
      left = targetRect.left + targetRect.width + gap
    } else if (placement === 'left') {
      top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2
      left = targetRect.left - tooltipWidth - gap
    } else {
      // center
      top = window.innerHeight / 2 - tooltipHeight / 2
      left = window.innerWidth / 2 - tooltipWidth / 2
    }

    // Boundary constraints
    if (left < margin) left = margin
    if (left + tooltipWidth > window.innerWidth - margin) {
      left = window.innerWidth - tooltipWidth - margin
    }
    if (top < margin) top = margin
    if (top + tooltipHeight > window.innerHeight - margin) {
      top = window.innerHeight - tooltipHeight - margin
    }

    setTooltipPos({ top, left })
  }, [targetRect, currentStep])

  useEffect(() => {
    if (!isOpen) return

    // Immediately measure and schedule staggered measures to smoothly capture modal entrance animations
    updateRect()
    const t1 = window.setTimeout(updateRect, 60)
    const t2 = window.setTimeout(updateRect, 180)
    const t3 = window.setTimeout(updateRect, 320)

    let rafId: number | null = null
    const handleResizeOrScroll = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(() => {
        rafId = null
        updateRect()
      })
    }

    window.addEventListener('resize', handleResizeOrScroll, { passive: true })
    window.addEventListener('scroll', handleResizeOrScroll, { capture: true, passive: true })

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener('resize', handleResizeOrScroll)
      window.removeEventListener('scroll', handleResizeOrScroll, true)
    }
  }, [isOpen, currentIndex, updateRect])

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleFinish(false)
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (currentIndex < steps.length - 1) {
          setCurrentIndex((prev) => prev + 1)
        } else {
          handleFinish(true)
        }
      } else if (e.key === 'ArrowLeft') {
        if (currentIndex > 0) {
          setCurrentIndex((prev) => prev - 1)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, currentIndex, steps.length])

  const handleFinish = (_completed: boolean) => {
    try {
      if (storageKey) {
        localStorage.setItem(storageKey, 'true')
      }
    } catch {}
    onClose()
  }

  const handleNext = () => {
    if (currentIndex < steps.length - 1) {
      setCurrentIndex((prev) => prev + 1)
    } else {
      handleFinish(true)
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1)
    }
  }

  return (
    <AnimatePresence
      onExitComplete={() => {
        setCurrentIndex(0)
        safeToRemove?.()
      }}
    >
      {active && currentStep && (
        <motion.div
          key="spotlight-tour-layer"
          className="spotlight-tour-layer"
          role="dialog"
          aria-modal="true"
          aria-label="沉浸式新手实景引导"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Spotlight cutout mask */}
          {targetRect && (
            <motion.div
              className="spotlight-cutout"
              initial={false}
              animate={{
                top: targetRect.top,
                left: targetRect.left,
                width: targetRect.width,
                height: targetRect.height
              }}
              exit={{ opacity: 0 }}
              transition={{
                type: 'spring',
                stiffness: 350,
                damping: 32
              }}
            >
              <div className="spotlight-pulse" />
            </motion.div>
          )}

          {/* Floating Tooltip Card */}
          <motion.div
            ref={tooltipRef}
            className="spotlight-tooltip-card"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            style={{
              top: `${tooltipPos.top}px`,
              left: `${tooltipPos.left}px`
            }}
          >
            {/* Card Header */}
            <div className="tour-card-header">
              <div className="tour-step-badge">
                {currentStep.icon}
                <span>
                  步骤 {currentIndex + 1} / {steps.length}
                </span>
              </div>
              {currentStep.sceneDialog && (
                <div className="tour-scene-tag">
                  <Eye size={12} />
                  <span>实景沉浸中</span>
                </div>
              )}
              <button
                type="button"
                className="tour-close-btn"
                title="退出引导 (Esc)"
                onClick={() => handleFinish(false)}
              >
                <X size={16} />
              </button>
            </div>

            {/* Card Content */}
            <div className="tour-card-body">
              <h3 className="tour-step-title">{currentStep.title}</h3>
              {currentStep.subtitle && <p className="tour-step-subtitle">{currentStep.subtitle}</p>}
              <div className="tour-step-content">
                {currentStep.content.split('\n').map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
              </div>

              {currentStep.tip && (
                <div className="tour-step-tip">
                  <Lightbulb size={14} className="tour-tip-icon" />
                  <span>{currentStep.tip}</span>
                </div>
              )}
            </div>

            {/* Card Footer */}
            <div className="tour-card-footer">
              <div className="tour-dots">
                {steps.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`tour-dot ${idx === currentIndex ? 'active' : ''} ${
                      idx < currentIndex ? 'passed' : ''
                    }`}
                    title={`跳转至第 ${idx + 1} 步`}
                    onClick={() => setCurrentIndex(idx)}
                  />
                ))}
              </div>

              <div className="tour-actions">
                <button
                  type="button"
                  className="tour-btn text"
                  onClick={() => handleFinish(false)}
                >
                  跳过引导
                </button>

                {currentIndex > 0 && (
                  <button
                    type="button"
                    className="tour-btn secondary"
                    onClick={handlePrev}
                  >
                    <ChevronLeft size={14} />
                    上一步
                  </button>
                )}

                <button
                  type="button"
                  className="tour-btn primary"
                  onClick={handleNext}
                >
                  {currentIndex < steps.length - 1 ? (
                    <>
                      下一步
                      <ChevronRight size={14} />
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      完成探索
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
