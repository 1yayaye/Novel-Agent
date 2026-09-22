import { motion } from 'motion/react'
import { AlertCircle, BookOpen, ChevronRight, Clock, FolderInput, FolderOpen } from 'lucide-react'
import type { RecentProject } from '../../../shared/project'

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
  error: string
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
      <main className="shelf">
        <section className="empty-shelf">
          <div className="book-spine" />
          <div className="empty-copy">
            <div className="section-label">项目库</div>
            <h1>还没有作品项目</h1>
            <p>导入已有原文，开始在本地工作台中整理和编辑章节。</p>
            {error && <p className="inline-error">{error}</p>}
            <div className="empty-actions">
              <button className="primary-button import-button" onClick={onStartImport}>
                <FolderInput size={17} />导入作品
              </button>
              <button className="secondary-button" onClick={onChooseOpen}>
                <FolderOpen size={17} />打开本地工程
              </button>
            </div>
          </div>
          <div className="shelf-mark"><BookOpen /></div>
        </section>
      </main>
    )
  }

  return (
    <main className="shelf">
      <div className="shelf-header">
        <div className="shelf-title-group">
          <div className="section-label">作品书架</div>
          <h1>我的作品库</h1>
          <p className="shelf-subtitle">选择已有作品继续创作，或导入新小说章节。</p>
        </div>
        <div className="shelf-actions">
          <button className="secondary-button" onClick={onChooseOpen} title="选择并打开本地 .novelproj 工程文件">
            <FolderOpen size={16} />打开本地工程
          </button>
          <button className="primary-button import-button" onClick={onStartImport}>
            <FolderInput size={16} />导入作品
          </button>
        </div>
      </div>

      {error && <p className="inline-error" style={{ marginBottom: '20px' }}>{error}</p>}

      <div className="shelf-grid">
        {displayProjects.map((item, index) => (
          <motion.article
            key={item.path}
            className={`project-card ${!item.isAvailable ? 'unavailable' : ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: index * 0.04 }}
            onClick={() => {
              if (item.isAvailable) onOpenProject(item.path)
            }}
          >
            <div className="project-card-spine" />
            <div className="project-card-content">
              <div className="project-card-header">
                <h3 className="project-card-title" title={item.title}>
                  {item.title || '未命名作品'}
                </h3>
              </div>
              <div className="project-card-path" title={item.path}>
                {item.path}
              </div>
              {item.sourcePath && (
                <div className="project-card-source" title={`原文副本：${item.sourcePath}`} style={{ fontSize: '10px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left', fontFamily: 'monospace' }}>
                  源：{item.sourcePath}
                </div>
              )}
              <div className="project-card-footer">
                <span className="project-card-time">
                  <Clock size={13} />
                  {formatLastOpened(item.lastOpenedAt)}
                </span>
                {item.isAvailable ? (
                  <button
                    className="card-action-button"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenProject(item.path)
                    }}
                  >
                    <span>继续写作</span>
                    <ChevronRight size={14} />
                  </button>
                ) : (
                  <span className="project-card-warning" title="该路径下的工程文件不存在或已被移动">
                    <AlertCircle size={13} />
                    文件不存在
                  </span>
                )}
              </div>
            </div>
          </motion.article>
        ))}
      </div>
    </main>
  )
}
