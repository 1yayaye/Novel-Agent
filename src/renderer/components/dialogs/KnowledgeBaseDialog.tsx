import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Check, Plus, Trash2, Users, X } from 'lucide-react'
import { CharacterRelationship, KnowledgeEntry, KnowledgeKind, KnowledgeState } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { knowledgeKindLabel, foreshadowStateLabel } from '../../utils/constants'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function KnowledgeBaseDialog({
  sessionId,
  isReadOnly,
  onClose
}: {
  sessionId: string
  isReadOnly: boolean
  onClose: () => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [activeTab, setActiveTab] = useState<'character' | 'world' | 'timeline' | 'foreshadow' | 'relationship'>('character')
  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'archived'>('active')
  const [searchQuery, setSearchQuery] = useState('')
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [isNewEntry, setIsNewEntry] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Entry Form state
  const [formTitle, setFormTitle] = useState('')
  const [formKind, setFormKind] = useState<KnowledgeKind>('character')
  const [formAliases, setFormAliases] = useState('')
  const [formAuthorContent, setFormAuthorContent] = useState('')
  const [formTags, setFormTags] = useState('')
  const [formIdentity, setFormIdentity] = useState('')
  const [formCurrentState, setFormCurrentState] = useState('')
  const [formNarrativeOrder, setFormNarrativeOrder] = useState<string>('')
  const [formStoryTime, setFormStoryTime] = useState('')
  const [formRelativeTime, setFormRelativeTime] = useState('')
  const [formTimeUncertain, setFormTimeUncertain] = useState(false)
  const [formForeshadowState, setFormForeshadowState] = useState<string>('planted')
  const [formVersion, setFormVersion] = useState(1)
  const [formState, setFormState] = useState<KnowledgeState>('active')

  // Relationship state
  const [relationships, setRelationships] = useState<CharacterRelationship[]>([])
  const [includeArchivedRels, setIncludeArchivedRels] = useState(false)
  const [creatingRel, setCreatingRel] = useState(false)
  const [relFromId, setRelFromId] = useState('')
  const [relToId, setRelToId] = useState('')
  const [relType, setRelType] = useState('')
  const [relDesc, setRelDesc] = useState('')

  const loadEntries = useCallback(async () => {
    if (activeTab === 'relationship') return
    try {
      const list = await window.novelAgent.knowledge.list({
        sessionId,
        kind: activeTab,
        state: stateFilter === 'all' ? undefined : stateFilter,
        query: searchQuery.trim() || undefined
      })
      setEntries(list)
      if (list.length > 0 && !selectedEntryId && !isNewEntry) {
        selectEntry(list[0])
      }
    } catch (err) {
      setError(errorText(err, '无法加载知识条目'))
    }
  }, [sessionId, activeTab, stateFilter, searchQuery, selectedEntryId, isNewEntry])

  const loadRelationships = useCallback(async () => {
    if (activeTab !== 'relationship') return
    try {
      const list = await window.novelAgent.relationship.list({
        sessionId,
        includeArchived: includeArchivedRels
      })
      setRelationships(list)
    } catch (err) {
      setError(errorText(err, '无法加载人物关系'))
    }
  }, [sessionId, activeTab, includeArchivedRels])

  useEffect(() => {
    if (activeTab === 'relationship') {
      void loadRelationships()
    } else {
      void loadEntries()
    }
  }, [activeTab, loadEntries, loadRelationships])

  const selectEntry = (e: KnowledgeEntry) => {
    setIsNewEntry(false)
    setSelectedEntryId(e.id)
    setFormTitle(e.title)
    setFormKind(e.knowledgeKind)
    setFormAliases(e.aliases.join(', '))
    setFormAuthorContent(e.authorContent)
    setFormTags(e.tags.join(', '))
    setFormIdentity(e.identity || '')
    setFormCurrentState(e.currentState || '')
    setFormNarrativeOrder(e.narrativeOrder !== null && e.narrativeOrder !== undefined ? String(e.narrativeOrder) : '')
    setFormStoryTime(e.storyTime || '')
    setFormRelativeTime(e.relativeTime || '')
    setFormTimeUncertain(Boolean(e.timeUncertain))
    setFormForeshadowState(e.foreshadowState || 'planted')
    setFormVersion(e.version)
    setFormState(e.state)
    setError('')
  }

  const startNewEntry = () => {
    setIsNewEntry(true)
    setSelectedEntryId(null)
    setFormTitle('新建条目')
    setFormKind(activeTab !== 'relationship' ? activeTab : 'character')
    setFormAliases('')
    setFormAuthorContent('')
    setFormTags('')
    setFormIdentity('')
    setFormCurrentState('')
    setFormNarrativeOrder('')
    setFormStoryTime('')
    setFormRelativeTime('')
    setFormTimeUncertain(false)
    setFormForeshadowState('planted')
    setFormVersion(1)
    setFormState('active')
    setError('')
  }

  const saveEntry = async () => {
    try {
      setSaving(true)
      setError('')
      const aliases = formAliases.split(/[,，]/).map((a) => a.trim()).filter(Boolean)
      const tags = formTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      const narrativeOrder = formNarrativeOrder ? parseInt(formNarrativeOrder, 10) : undefined

      if (isNewEntry) {
        const created = await window.novelAgent.knowledge.create({
          sessionId,
          kind: formKind,
          title: formTitle,
          aliases,
          authorContent: formAuthorContent,
          tags,
          identity: formIdentity || undefined,
          currentState: formCurrentState || undefined,
          narrativeOrder: isNaN(narrativeOrder as number) ? undefined : narrativeOrder,
          storyTime: formStoryTime || undefined,
          relativeTime: formRelativeTime || undefined,
          timeUncertain: formTimeUncertain,
          foreshadowState: formForeshadowState || undefined
        })
        setIsNewEntry(false)
        setSelectedEntryId(created.id)
        setFormVersion(created.version)
      } else if (selectedEntryId) {
        const updated = await window.novelAgent.knowledge.update({
          sessionId,
          entryId: selectedEntryId,
          title: formTitle,
          aliases,
          authorContent: formAuthorContent,
          tags,
          identity: formIdentity || null,
          currentState: formCurrentState || null,
          narrativeOrder: isNaN(narrativeOrder as number) ? null : (narrativeOrder ?? null),
          storyTime: formStoryTime || null,
          relativeTime: formRelativeTime || null,
          timeUncertain: formTimeUncertain,
          foreshadowState: formForeshadowState || null,
          expectedVersion: formVersion
        })
        setFormVersion(updated.version)
      }
      await loadEntries()
    } catch (err) {
      setError(errorText(err, '保存条目失败'))
    } finally {
      setSaving(false)
    }
  }

  const toggleArchive = async () => {
    if (!selectedEntryId || isNewEntry) return
    try {
      setError('')
      if (formState === 'active') {
        const archived = await window.novelAgent.knowledge.archive({
          sessionId,
          entryId: selectedEntryId,
          expectedVersion: formVersion
        })
        setFormState(archived.state)
        setFormVersion(archived.version)
      } else {
        const restored = await window.novelAgent.knowledge.restore({
          sessionId,
          entryId: selectedEntryId,
          expectedVersion: formVersion
        })
        setFormState(restored.state)
        setFormVersion(restored.version)
      }
      await loadEntries()
    } catch (err) {
      setError(errorText(err, '状态更新失败'))
    }
  }

  const deleteEntry = async () => {
    if (!selectedEntryId || isNewEntry) return
    try {
      setError('')
      await window.novelAgent.knowledge.delete({
        sessionId,
        entryId: selectedEntryId,
        expectedVersion: formVersion
      })
      setSelectedEntryId(null)
      await loadEntries()
    } catch (err) {
      setError(errorText(err, '删除条目失败'))
    }
  }

  const submitCreateRel = async () => {
    if (!relFromId || !relToId || !relType.trim()) return
    try {
      setError('')
      await window.novelAgent.relationship.create({
        sessionId,
        fromCharacterId: relFromId,
        toCharacterId: relToId,
        relationType: relType.trim(),
        description: relDesc.trim()
      })
      setCreatingRel(false)
      setRelType('')
      setRelDesc('')
      await loadRelationships()
    } catch (err) {
      setError(errorText(err, '创建人物关系失败'))
    }
  }

  const deleteRel = async (rel: CharacterRelationship) => {
    try {
      await window.novelAgent.relationship.delete({
        sessionId,
        relationshipId: rel.id,
        expectedVersion: rel.version
      })
      await loadRelationships()
    } catch (err) {
      setError(errorText(err, '删除人物关系失败'))
    }
  }

  // Get list of characters for relationship dropdown
  const [characterOptions, setCharacterOptions] = useState<KnowledgeEntry[]>([])
  useEffect(() => {
    if (activeTab === 'relationship') {
      void window.novelAgent.knowledge
        .list({ sessionId, kind: 'character', state: 'active' })
        .then((chars) => {
          setCharacterOptions(chars)
          if (chars.length >= 2 && !relFromId) {
            setRelFromId(chars[0].id)
            setRelToId(chars[1].id)
          }
        })
        .catch(() => {})
    }
  }, [sessionId, activeTab, relFromId])

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div ref={dialogRef} className="knowledge-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-title" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2 id="knowledge-title">作品知识库</h2>
            <p>管理人物档案、世界观设定、事件时间线、伏笔追踪及人物有向关系。</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div className="tab-filter-bar">
          <div className="tab-chips">
            <button className={`tab-chip ${activeTab === 'character' ? 'active' : ''}`} onClick={() => { setActiveTab('character'); setSelectedEntryId(null); setIsNewEntry(false) }}>
              人物 (Characters)
            </button>
            <button className={`tab-chip ${activeTab === 'world' ? 'active' : ''}`} onClick={() => { setActiveTab('world'); setSelectedEntryId(null); setIsNewEntry(false) }}>
              世界观 (World)
            </button>
            <button className={`tab-chip ${activeTab === 'timeline' ? 'active' : ''}`} onClick={() => { setActiveTab('timeline'); setSelectedEntryId(null); setIsNewEntry(false) }}>
              时间线 (Timeline)
            </button>
            <button className={`tab-chip ${activeTab === 'foreshadow' ? 'active' : ''}`} onClick={() => { setActiveTab('foreshadow'); setSelectedEntryId(null); setIsNewEntry(false) }}>
              伏笔 (Foreshadow)
            </button>
            <button className={`tab-chip ${activeTab === 'relationship' ? 'active' : ''}`} onClick={() => setActiveTab('relationship')}>
              <Users size={14} />人物关系图谱
            </button>
          </div>

          {activeTab !== 'relationship' && (
            <div className="tab-chips">
              <button className={`tab-chip ${stateFilter === 'active' ? 'active' : ''}`} onClick={() => setStateFilter('active')}>
                活跃条目
              </button>
              <button className={`tab-chip ${stateFilter === 'archived' ? 'active' : ''}`} onClick={() => setStateFilter('archived')}>
                已归档条目
              </button>
              <button className={`tab-chip ${stateFilter === 'all' ? 'active' : ''}`} onClick={() => setStateFilter('all')}>
                全部
              </button>
            </div>
          )}
        </div>

        {error && <p className="inline-error dialog-error">{error}</p>}

        {activeTab !== 'relationship' ? (
          <div className="knowledge-body">
            <aside className="knowledge-sidebar">
              <div className="sidebar-header">
                <span>{knowledgeKindLabel[activeTab]}条目 ({entries.length})</span>
                <IconButton label="新建条目" onClick={startNewEntry} disabled={isReadOnly}>
                  <Plus size={15} />
                </IconButton>
              </div>
              <div className="sidebar-search">
                <input
                  placeholder="搜索条目标题或正文..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="entry-list">
                {entries.map((e) => (
                  <button
                    key={e.id}
                    className={`entry-card ${!isNewEntry && selectedEntryId === e.id ? 'active' : ''}`}
                    onClick={() => selectEntry(e)}
                  >
                    <div className="entry-card-header">
                      <span className="entry-card-title">{e.title}</span>
                      <span className={`status-badge ${e.state}`}>
                        {e.state === 'active' ? `v${e.version}` : '已归档'}
                      </span>
                    </div>
                    <span className="entry-card-preview">{e.authorContent || '暂无作者正文'}</span>
                  </button>
                ))}
              </div>
            </aside>
            <main className="knowledge-detail">
              {(selectedEntryId || isNewEntry) ? (
                <>
                  <div className="detail-header">
                    <div>
                      <h2>{isNewEntry ? `新建${knowledgeKindLabel[formKind]}` : formTitle}</h2>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <span className={`status-badge ${formState}`}>
                          {formState === 'active' ? '活跃' : '已归档'}
                        </span>
                        {!isNewEntry && <span className="entry-card-meta">版本 v{formVersion}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="detail-form">
                    <div className="form-row">
                      <div className="form-field">
                        <label>标题</label>
                        <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="条目标题" />
                      </div>
                      <div className="form-field">
                        <label>别名 (逗号分隔)</label>
                        <input value={formAliases} onChange={(e) => setFormAliases(e.target.value)} placeholder="别名、绰号" />
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-field">
                        <label>标签 (逗号分隔)</label>
                        <input value={formTags} onChange={(e) => setFormTags(e.target.value)} placeholder="主角, 正派, 剑宗" />
                      </div>
                      {formKind === 'character' && (
                        <div className="form-field">
                          <label>身份 / 职业</label>
                          <input value={formIdentity} onChange={(e) => setFormIdentity(e.target.value)} placeholder="例如：宗门长老、主角师尊" />
                        </div>
                      )}
                      {formKind === 'timeline' && (
                        <div className="form-field">
                          <label>叙事顺序</label>
                          <input type="number" value={formNarrativeOrder} onChange={(e) => setFormNarrativeOrder(e.target.value)} placeholder="1, 2, 3..." />
                        </div>
                      )}
                      {formKind === 'foreshadow' && (
                        <div className="form-field">
                          <label>伏笔状态</label>
                          <select value={formForeshadowState} onChange={(e) => setFormForeshadowState(e.target.value)}>
                            <option value="planted">铺设中 (planted)</option>
                            <option value="developing">发展中 (developing)</option>
                            <option value="resolved">已揭示 (resolved)</option>
                            <option value="abandoned">已废弃 (abandoned)</option>
                          </select>
                        </div>
                      )}
                    </div>

                    {formKind === 'character' && (
                      <div className="form-field">
                        <label>当前状态 / 境界</label>
                        <input value={formCurrentState} onChange={(e) => setFormCurrentState(e.target.value)} placeholder="例如：筑基中期、负伤闭关" />
                      </div>
                    )}

                    {formKind === 'timeline' && (
                      <div className="form-row">
                        <div className="form-field">
                          <label>故事内时间</label>
                          <input value={formStoryTime} onChange={(e) => setFormStoryTime(e.target.value)} placeholder="例如：天元历三万年春" />
                        </div>
                        <div className="form-field">
                          <label>相对时间</label>
                          <input value={formRelativeTime} onChange={(e) => setFormRelativeTime(e.target.value)} placeholder="例如：大战后三年" />
                        </div>
                        <div className="checkbox-field" style={{ gridColumn: 'span 2' }}>
                          <input type="checkbox" id="timeUncertain" checked={formTimeUncertain} onChange={(e) => setFormTimeUncertain(e.target.checked)} />
                          <label htmlFor="timeUncertain">时间推测/不确定</label>
                        </div>
                      </div>
                    )}

                    <div className="form-field" style={{ flex: 1 }}>
                      <label>作者正文 (权威知识正文，AI 绝不直接覆盖)</label>
                      <textarea
                        style={{ minHeight: 180 }}
                        value={formAuthorContent}
                        onChange={(e) => setFormAuthorContent(e.target.value)}
                        placeholder="输入作者维护的知识详情描述..."
                      />
                    </div>

                    <div className="form-actions">
                      <div style={{ display: 'flex', gap: 8 }}>
                        {!isNewEntry && (
                          <>
                            <button type="button" className="text-button" onClick={() => void toggleArchive()}>
                              {formState === 'active' ? '归档条目' : '恢复条目'}
                            </button>
                            <button type="button" className="text-button" style={{ color: '#b91c1c' }} onClick={() => void deleteEntry()}>
                              <Trash2 size={14} />删除条目
                            </button>
                          </>
                        )}
                      </div>
                      <button className="primary-button" disabled={isReadOnly || saving || !formTitle.trim()} onClick={() => void saveEntry()}>
                        <Check size={14} />{saving ? '保存中...' : '保存条目'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="empty-hint" style={{ margin: 'auto' }}>请选择或新建一个知识条目</p>
              )}
            </main>
          </div>
        ) : (
          <div className="relationship-container">
            <div className="rel-toolbar">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button className="primary-button" disabled={isReadOnly || characterOptions.length < 2} onClick={() => setCreatingRel(true)}>
                  <Plus size={14} />新建人物关系
                </button>
                <label className="checkbox-field" style={{ margin: 0 }}>
                  <input type="checkbox" checked={includeArchivedRels} onChange={(e) => setIncludeArchivedRels(e.target.checked)} />
                  <span>显示涉及已归档人物的关系</span>
                </label>
              </div>
              <span style={{ fontSize: 12, color: '#6b7280' }}>共 {relationships.length} 条人物关系记录</span>
            </div>

            {creatingRel && (
              <div className="suggestion-card" style={{ background: '#fcf9f8' }}>
                <h3>新建有向人物关系</h3>
                <div className="form-row">
                  <div className="form-field">
                    <label>起始主体 (From)</label>
                    <select value={relFromId} onChange={(e) => setRelFromId(e.target.value)}>
                      {characterOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-field">
                    <label>目标主体 (To)</label>
                    <select value={relToId} onChange={(e) => setRelToId(e.target.value)}>
                      {characterOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-field">
                    <label>关系类型</label>
                    <input value={relType} onChange={(e) => setRelType(e.target.value)} placeholder="例如：同门、宿敌、师徒" />
                  </div>
                  <div className="form-field">
                    <label>关系说明</label>
                    <input value={relDesc} onChange={(e) => setRelDesc(e.target.value)} placeholder="关系背景与细节" />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button type="button" className="text-button" onClick={() => setCreatingRel(false)}>取消</button>
                  <button type="button" className="primary-button" disabled={!relType.trim() || relFromId === relToId} onClick={() => void submitCreateRel()}>
                    创建关系
                  </button>
                </div>
              </div>
            )}

            <div className="rel-list">
              {relationships.map((r) => (
                <div key={r.id} className="rel-card">
                  <div className="rel-edge">
                    <span>{r.fromCharacterTitle}</span>
                    <ArrowRight size={14} style={{ color: '#2d5a27' }} />
                    <span className="rel-type-tag">{r.relationType}</span>
                    <ArrowRight size={14} style={{ color: '#2d5a27' }} />
                    <span>{r.toCharacterTitle}</span>
                  </div>
                  {r.description && <p className="rel-desc">{r.description}</p>}
                  <div className="rel-actions">
                    <button type="button" className="text-button" style={{ color: '#b91c1c' }} onClick={() => void deleteRel(r)}>
                      <Trash2 size={13} />删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <footer className="dialog-footer">
          <span>知识条目更新后自动递增 search_revision 并触发 FTS 同步</span>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
