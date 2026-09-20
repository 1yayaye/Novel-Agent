import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Ticket 09: Visual Polish, Icons Deduplication, Alert Banner Success and Font Stack', () => {
  const cssPath = resolve(__dirname, '../src/renderer/styles.css')
  const css = readFileSync(cssPath, 'utf8')
  const workbenchTsxPath = resolve(__dirname, '../src/renderer/components/workbench/Workbench.tsx')
  const workbenchTsx = readFileSync(workbenchTsxPath, 'utf8')
  const connDialogTsxPath = resolve(__dirname, '../src/renderer/components/dialogs/ConnectionEditDialog.tsx')
  const connDialogTsx = readFileSync(connDialogTsxPath, 'utf8')
  const inspectorTsxPath = resolve(__dirname, '../src/renderer/components/editor/Inspector.tsx')
  const inspectorTsx = readFileSync(inspectorTsxPath, 'utf8')

  it('uses distinct ScrollText icon for full-book outline synopsis and Compass for project outline', () => {
    // Project Outline (项目大纲) uses Compass
    expect(workbenchTsx).toMatch(/title="项目大纲[^"]*"[\s\S]*?<Compass/)

    // Full Book Outline Synopsis (全书大纲) uses ScrollText
    expect(workbenchTsx).toMatch(/title="全书大纲[^"]*"[\s\S]*?<ScrollText/)

    // Imported ScrollText from lucide-react
    expect(workbenchTsx).toContain('ScrollText')
  })

  it('removes duplicate undo/redo buttons in workbench topbar to prevent 40px visual clutter', () => {
    // Topbar toolbar has only global controls: Help, Save status, Export, Chapter drawer, Window controls
    expect(workbenchTsx).not.toContain('label="撤销"')
    expect(workbenchTsx).not.toContain('label="重做"')
  })

  it('defines .alert-banner.success with emerald green theme styles', () => {
    expect(css).toContain('.alert-banner.success{background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46}')
    expect(css).toContain('.theme-dark .alert-banner.success')
    expect(connDialogTsx).toContain("testResult.success ? 'success' : 'danger'")
  })

  it('configures modern Chinese typography font stacks with high-resolution fallbacks', () => {
    // Root font stack
    expect(css).toContain('font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Source Han Sans SC","Noto Sans SC",sans-serif')

    // Serif font stack includes modern Songti / STSong / Microsoft YaHei before generic serif to avoid jagged SimSun
    expect(css).toContain('.chapter-editor-container.font-serif .cm-content{font-family:"Noto Serif SC","Source Han Serif SC","Source Han Serif CN","Songti SC","STSong","Microsoft YaHei","PingFang SC","Hiragino Sans GB",serif}')

    // Sans font stack includes modern system fonts
    expect(css).toContain('.chapter-editor-container.font-sans .cm-content{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Source Han Sans SC","Noto Sans SC",sans-serif}')
  })

  it('removes hardcoded development period notes from inspector sidebar', () => {
    expect(inspectorTsx).not.toContain('本阶段已提供快照、备份与导出能力')
  })
})
