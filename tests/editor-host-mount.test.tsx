/**
 * @vitest-environment jsdom
 */
import React, { useEffect } from 'react'
import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Chapter } from '../src/shared/project'
import { EditorHost } from '../src/renderer/features/editor/EditorHost'
import { useEditorStore } from '../src/renderer/stores/useEditorStore'
import type { EditorPreferences } from '../src/renderer/types/editor'

const sessionId = '00000000-0000-4000-8000-000000000001'
const chapter: Chapter = {
  id: '00000000-0000-4000-8000-000000000002',
  title: '第一章',
  position: 0,
  content: '导入后的正文。',
  version: 1,
  createdAt: 1,
  updatedAt: 1
}

const preferences: EditorPreferences = {
  theme: 'light',
  fontSize: 18,
  fontFamily: 'serif',
  contentWidth: 'normal',
  indentParagraphs: true,
  highlightLine: true
}

function WorkbenchHarness() {
  const { activeChapter, loadChapter } = useEditorStore()
  useEffect(() => {
    loadChapter(chapter, false)
  }, [loadChapter])
  if (!activeChapter) return <div>等待章节</div>
  return (
    <EditorHost
      sessionId={sessionId}
      chapter={activeChapter}
      preferences={preferences}
      isZenMode={false}
      onToggleZenMode={() => {}}
      onSaved={(updated) => {
        loadChapter(updated, false)
      }}
      onPreferencesChange={() => {}}
      setHandle={() => {}}
    />
  )
}

afterEach(() => {
  document.body.innerHTML = ''
  useEditorStore.setState({
    activeChapter: null,
    content: '',
    saveState: 'saved',
    wordCount: 0,
    selection: null,
    isReadOnly: false
  })
})

describe('EditorHost mount after import', () => {
  it('stays mounted when the workbench passes fresh save and handle callbacks', async () => {
    const view = render(<WorkbenchHarness />)
    await waitFor(() => {
      expect(view.container.querySelector('.cm-content')).toBeTruthy()
    })
    expect(view.container.textContent).toContain('第一章')
    expect(view.container.textContent).toContain('导入后的正文。')
  })
})
