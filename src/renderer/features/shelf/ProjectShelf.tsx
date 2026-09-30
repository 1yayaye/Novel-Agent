import React from 'react'
import { AlertCircle, BookOpen, ChevronRight, Clock, FolderInput, FolderOpen } from 'lucide-react'
import type { RecentProject } from '../../../shared/project'
import { Button } from '@appica/ui-react/button'
import { Card } from '@appica/ui-react/card'
import { Alert, AlertDescription } from '@appica/ui-react/alert'

function formatLastOpened(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 小时前`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 天前`
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function ProjectShelf({
  recentProjects,
  error,
  onOpenProject,
  onChooseOpen,
  onStartImport
}: {
  recentProjects: RecentProject[]
  error: string | null
  onOpenProject: (path: string) => void
  onChooseOpen: () => void
  onStartImport: () => void
}) {
  const availableProjects = recentProjects.filter((p) => p.isAvailable)
  const displayProjects = availableProjects.filter(
    (project, index, self) => index === self.findIndex((p) => p.title === project.title || p.path === project.path)
  )

  if (displayProjects.length === 0) {
    return (
      <main className="flex-1 overflow-y-auto p-8 flex items-center justify-center">
        <section className="max-w-xl w-full text-center space-y-6 bg-[#f5efe6]/70 border border-[#e5ddd3] p-10 rounded-2xl shadow-sm">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-[#efe6da] flex items-center justify-center text-[#2d6a4f] shadow-inner">
            <BookOpen size={32} />
          </div>
          <div className="space-y-2">
            <div className="inline-block text-xs font-semibold tracking-wider text-[#b45309] uppercase bg-[#fef3c7] px-3 py-0.5 rounded-full">
              作品书架
            </div>
            <h1 className="text-2xl font-bold text-[#2c2523] font-serif">还没有作品项目</h1>
            <p className="text-sm text-[#7d6b59] max-w-md mx-auto leading-relaxed">
              纸白墨润，静待下笔。导入已有原文文档或选择本地作品工程，开始在本地专属工作台中整理和创作。
            </p>
          </div>

          {error && (
            <Alert variant="error" className="text-xs flex items-center gap-2 justify-center">
              <AlertCircle size={15} />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button onClick={onStartImport} className="gap-2">
              <FolderInput size={16} />
              <span>导入作品原文</span>
            </Button>
            <Button variant="secondary" onClick={onChooseOpen} className="gap-2">
              <FolderOpen size={16} />
              <span>打开本地工程 (.novelproj)</span>
            </Button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#e5ddd3] pb-6">
        <div className="space-y-1">
          <div className="inline-block text-xs font-semibold tracking-wider text-[#b45309] uppercase bg-[#fef3c7] px-2.5 py-0.5 rounded-full">
            作品书架
          </div>
          <h1 className="text-2xl font-bold text-[#2c2523] font-serif">我的作品库</h1>
          <p className="text-xs text-[#7d6b59]">选择已有小说继续执笔创作，或导入新篇章。</p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="outline" onClick={onChooseOpen} className="gap-2">
            <FolderOpen size={15} />
            <span>打开本地工程</span>
          </Button>
          <Button onClick={onStartImport} className="gap-2">
            <FolderInput size={15} />
            <span>导入作品</span>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="error" className="text-xs flex items-center gap-2">
          <AlertCircle size={15} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 texts-reveal">
        {displayProjects.map((item) => (
          <article
            key={item.path}
          >
            <Card
              onClick={() => {
                if (item.isAvailable) onOpenProject(item.path)
              }}
              className={`group relative overflow-hidden flex flex-col justify-between h-48 p-5 border-[#e5ddd3] bg-[#faf8f5] hover:bg-white hover:border-[#dacdbe] hover:shadow-md transition-all cursor-pointer ${
                !item.isAvailable ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            >
              {/* Left decorative book spine */}
              <div className="absolute top-0 bottom-0 left-0 w-2 bg-[#2d6a4f]/70 group-hover:bg-[#2d6a4f] transition-colors" />

              <div className="space-y-2 pl-2">
                <h3 className="font-bold text-base text-[#2c2523] font-serif line-clamp-1 group-hover:text-[#2d6a4f] transition-colors" title={item.title}>
                  {item.title || '未命名作品'}
                </h3>
                <div className="text-xs text-[#7d6b59] font-mono line-clamp-1" title={item.path}>
                  {item.path}
                </div>
                {item.sourcePath && (
                  <div className="text-[10px] text-[#baa997] font-mono line-clamp-1" title={`原文：${item.sourcePath}`}>
                    源：{item.sourcePath}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[#f0eae1] pl-2">
                <span className="flex items-center gap-1.5 text-xs text-[#7d6b59]">
                  <Clock size={13} />
                  {formatLastOpened(item.lastOpenedAt)}
                </span>
                {item.isAvailable ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-[#2d6a4f] group-hover:translate-x-0.5 transition-transform">
                    <span>继续写作</span>
                    <ChevronRight size={14} />
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-amber-600">
                    <AlertCircle size={13} />
                    文件不存在
                  </span>
                )}
              </div>
            </Card>
          </article>
        ))}
      </div>
    </main>
  )
}
