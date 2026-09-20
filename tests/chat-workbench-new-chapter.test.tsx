/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatWorkbenchDialog } from '../src/renderer/components/dialogs/ChatWorkbenchDialog'

const sessionId = '00000000-0000-0000-0000-000000000001'
const chapterId = '00000000-0000-0000-0000-000000000002'
const chatSessionId = '00000000-0000-0000-0000-000000000003'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn()
  })
})

describe('ChatWorkbenchDialog chapter creation workflow', () => {
  it('creates the first chapter, links its title, and starts the direction stage', async () => {
    const createdChapter = {
      id: chapterId,
      title: '第三章',
      position: 0,
      content: '',
      version: 1,
      createdAt: 1,
      updatedAt: 1
    }
    const createdChat = {
      id: chatSessionId,
      title: '创作：第三章',
      workflowType: 'creation_workflow' as const,
      targetChapterId: chapterId,
      stage: 'direction' as const,
      version: 1,
      createdAt: 1,
      updatedAt: 1
    }
    const chapterCreate = vi.fn().mockResolvedValue(createdChapter)
    const chatCreate = vi.fn().mockResolvedValue(createdChat)
    const onChapterCreated = vi.fn()

    Object.defineProperty(window, 'novelAgent', {
      configurable: true,
      value: {
        chapter: { create: chapterCreate },
        chat: {
          list: vi.fn().mockResolvedValue([]),
          create: chatCreate,
          listMessages: vi.fn().mockResolvedValue([]),
          getSummary: vi.fn().mockResolvedValue(null)
        },
        outline: { getLatestChapterOutline: vi.fn().mockResolvedValue(null) }
      }
    })

    const { getByRole, getByDisplayValue } = render(
      <ChatWorkbenchDialog
        sessionId={sessionId}
        chapters={[]}
        isReadOnly={false}
        onClose={vi.fn()}
        onChapterCreated={onChapterCreated}
      />
    )

    fireEvent.click(getByRole('button', { name: '新建' }))

    const chapterTitle = getByDisplayValue('第一章')
    expect(getByDisplayValue('创作：第一章')).toBeTruthy()
    fireEvent.change(chapterTitle, { target: { value: '第三章' } })
    expect(getByDisplayValue('创作：第三章')).toBeTruthy()

    fireEvent.click(getByRole('button', { name: '创建' }))

    await waitFor(() => expect(chatCreate).toHaveBeenCalledWith({
      sessionId,
      title: '创作：第三章',
      workflowType: 'creation_workflow',
      targetChapterId: chapterId,
      stage: 'direction'
    }))
    expect(chapterCreate).toHaveBeenCalledWith({ sessionId, title: '第三章', content: '' })
    expect(onChapterCreated).toHaveBeenCalledWith(createdChapter)
  })
})
