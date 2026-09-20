import { describe, expect, it } from 'vitest'
import { DEFAULT_TOUR_STEPS } from '../src/renderer/components/dialogs/SpotlightTour'

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
})
