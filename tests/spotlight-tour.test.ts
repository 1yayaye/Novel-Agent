/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'
import { SpotlightTour, DEFAULT_TOUR_STEPS } from '../src/renderer/components/dialogs/SpotlightTour'

describe('Automated Immersive Real-Scene Onboarding Tour', () => {
  it('defines 9 automated real-scene tour steps in logical sequence', () => {
    expect(DEFAULT_TOUR_STEPS).toHaveLength(9)

    const stepIds = DEFAULT_TOUR_STEPS.map((s) => s.id)
    expect(stepIds).toEqual([
      'connection-scene',
      'chapter-scene',
      'editor-scene',
      'context-scene',
      'outline-scene',
      'chat-scene',
      'knowledge-scene',
      'inspector-scene',
      'finish-scene'
    ])
  })

  it('ensures each step has meaningful title, content, icon and valid selector list', () => {
    for (const step of DEFAULT_TOUR_STEPS) {
      expect(step.title).toBeTruthy()
      expect(step.content.length).toBeGreaterThan(20)
      expect(step.targetSelector).toBeTruthy()
      expect(step.icon).toBeDefined()
      expect(['top', 'bottom', 'left', 'right', 'center']).toContain(step.placement)
    }
  })

  it('correctly maps sceneDialogs to trigger real-scene modals during automated walkthrough', () => {
    const dialogMap = DEFAULT_TOUR_STEPS.map((s) => ({ id: s.id, sceneDialog: s.sceneDialog }))
    expect(dialogMap).toEqual([
      { id: 'connection-scene', sceneDialog: 'connection' },
      { id: 'chapter-scene', sceneDialog: null },
      { id: 'editor-scene', sceneDialog: null },
      { id: 'context-scene', sceneDialog: 'context' },
      { id: 'outline-scene', sceneDialog: 'outline' },
      { id: 'chat-scene', sceneDialog: 'chat' },
      { id: 'knowledge-scene', sceneDialog: 'knowledge' },
      { id: 'inspector-scene', sceneDialog: null },
      { id: 'finish-scene', sceneDialog: null }
    ])
  })

  it('covers crucial features in step contents: models, chapters, editor, context tokens, outline, chat, knowledge, and sqlite snapshots', () => {
    const connectionStep = DEFAULT_TOUR_STEPS.find((s) => s.id === 'connection-scene')!
    expect(connectionStep.content).toContain('模型')
    expect(connectionStep.tip).toContain('未配置模型')

    const chapterStep = DEFAULT_TOUR_STEPS.find((s) => s.id === 'chapter-scene')!
    expect(chapterStep.content).toContain('章节')

    const editorStep = DEFAULT_TOUR_STEPS.find((s) => s.id === 'editor-scene')!
    expect(editorStep.content).toContain('编辑器')
    expect(editorStep.content).toContain('禅模式')

    const contextStep = DEFAULT_TOUR_STEPS.find((s) => s.id === 'context-scene')!
    expect(contextStep.content).toContain('上下文装配')
    expect(contextStep.content).toContain('Token 预算')

    const outlineStep = DEFAULT_TOUR_STEPS.find((s) => s.id === 'outline-scene')!
    expect(outlineStep.content).toContain('大纲')

    const chatStep = DEFAULT_TOUR_STEPS.find((s) => s.id === 'chat-scene')!
    expect(chatStep.content).toContain('问答')

    const knowledgeStep = DEFAULT_TOUR_STEPS.find((s) => s.id === 'knowledge-scene')!
    expect(knowledgeStep.content).toContain('知识库')

    const inspectorStep = DEFAULT_TOUR_STEPS.find((s) => s.id === 'inspector-scene')!
    expect(inspectorStep.content).toContain('快照')
    expect(inspectorStep.content).toContain('.novelproj')
  })

  it('renders tour card and handles navigation and skip without crashing', () => {
    const onClose = vi.fn()
    const onStepChange = vi.fn()

    const { getByText, rerender, unmount } = render(
      React.createElement(SpotlightTour, {
        isOpen: true,
        steps: DEFAULT_TOUR_STEPS,
        onClose,
        onStepChange
      })
    )

    // Initial step rendered
    expect(screen.getByText(/步骤 1 \/ 9/)).toBeDefined()
    expect(onStepChange).toHaveBeenCalledWith(0, DEFAULT_TOUR_STEPS[0])

    // Click next button
    const nextBtn = getByText('下一步')
    fireEvent.click(nextBtn)
    expect(screen.getByText(/步骤 2 \/ 9/)).toBeDefined()

    // Press Escape to trigger finish/close
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    // Rerender with isOpen=false
    rerender(
      React.createElement(SpotlightTour, {
        isOpen: false,
        steps: DEFAULT_TOUR_STEPS,
        onClose,
        onStepChange
      })
    )

    unmount()
  })
})

