import React, { useEffect, useState } from 'react'
import { BookOpen, User, Tag, Plus, Search, Sparkles } from 'lucide-react'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { useProjectStore } from '../../stores/useProjectStore'

interface KnowledgeItem {
  id: string
  category: string
  name: string
  description?: string
  aliases?: string[]
}

export function KnowledgeDrawer() {
  const { project } = useProjectStore()
  const [entries, setEntries] = useState<KnowledgeItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState<'all' | 'character' | 'world' | 'item'>('all')

  useEffect(() => {
    if (!project) return
    window.novelAgent.knowledge
      .list({ sessionId: project.sessionId })
      .then((res: any[]) => {
        if (Array.isArray(res)) {
          setEntries(
            res.map((item) => ({
              id: item.id,
              category: item.category || 'character',
              name: item.name || item.title || '未命名设定',
              description: item.description || item.content || '',
              aliases: item.aliases || []
            }))
          )
        }
      })
      .catch(() => {})
  }, [project])

  const filteredEntries = entries.filter((entry) => {
    const matchesQuery =
      entry.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (entry.description && entry.description.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesCategory = filterCategory === 'all' || entry.category === filterCategory
    return matchesQuery && matchesCategory
  })

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Search & Filter */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#baa997]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索角色名、功法或设定..."
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-[#efe6da]/60 border border-[#dacdbe] rounded-xl text-[#2c2523] placeholder:text-[#baa997] focus:outline-none focus:ring-1 focus:ring-[#2d6a4f]"
          />
        </div>

        <div className="flex items-center gap-1 text-xs">
          {(['all', 'character', 'world', 'item'] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-2 py-0.5 rounded-full text-[11px] transition-colors ${
                filterCategory === cat
                  ? 'bg-[#2d6a4f] text-white'
                  : 'bg-[#efe6da] text-[#7d6b59] hover:bg-[#e5ddd3]'
              }`}
            >
              {cat === 'all' ? '全部' : cat === 'character' ? '人物' : cat === 'world' ? '世界观' : '物品'}
            </button>
          ))}
        </div>
      </div>

      {/* Entry Cards List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
        {filteredEntries.length === 0 ? (
          <div className="py-12 text-center text-xs text-[#baa997]">
            {searchQuery ? '未找到匹配设定' : '知识库暂无条目，可先提取全书设定'}
          </div>
        ) : (
          filteredEntries.map((item) => (
            <Card key={item.id} className="p-3.5 border-[#e5ddd3] bg-white space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-[#f5efe6] text-[#b45309] flex items-center justify-center">
                    <User size={13} />
                  </div>
                  <span className="text-xs font-bold text-[#2c2523] font-serif">{item.name}</span>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {item.category === 'character' ? '主角/人物' : '设定'}
                </Badge>
              </div>

              {item.description && (
                <p className="text-xs text-[#54473b] line-clamp-3 leading-relaxed">
                  {item.description}
                </p>
              )}

              {item.aliases && item.aliases.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {item.aliases.map((alias) => (
                    <span
                      key={alias}
                      className="text-[10px] text-[#7d6b59] bg-[#f5efe6] px-1.5 py-0.5 rounded"
                    >
                      {alias}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
