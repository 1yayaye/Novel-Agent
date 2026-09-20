import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { Check, Plus, Sliders, Sparkles, Tag, Trash2, X } from 'lucide-react'
import { CreativeRule, InstructionPreset, StyleSample, TaskType } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { taskTypeLabel } from '../../utils/constants'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function CreativeSettingsDialog({
  sessionId,
  isReadOnly,
  onClose
}: {
  sessionId: string
  isReadOnly: boolean
  onClose: () => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [activeTab, setActiveTab] = useState<'rules' | 'samples' | 'presets'>('rules')
  const [error, setError] = useState('')

  // Rules state
  const [rulesContent, setRulesContent] = useState('')
  const [rulesVersion, setRulesVersion] = useState(1)
  const [savedRulesContent, setSavedRulesContent] = useState('')
  const [savingRules, setSavingRules] = useState(false)

  // Samples state
  const [samples, setSamples] = useState<StyleSample[]>([])
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null)
  const [sampleName, setSampleName] = useState('')
  const [sampleTags, setSampleTags] = useState('')
  const [sampleContent, setSampleContent] = useState('')
  const [sampleVersion, setSampleVersion] = useState(1)
  const [isNewSample, setIsNewSample] = useState(false)
  const [savingSample, setSavingSample] = useState(false)

  // Presets state
  const [taskFilter, setTaskFilter] = useState<'all' | 'continue' | 'rewrite' | 'polish' | 'knowledge' | 'report' | 'chat'>('all')
  const [presets, setPresets] = useState<InstructionPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [presetType, setPresetType] = useState<'continue' | 'rewrite' | 'polish' | 'knowledge' | 'report' | 'chat'>('continue')
  const [presetName, setPresetName] = useState('')
  const [presetInstruction, setPresetInstruction] = useState('')
  const [presetVersion, setPresetVersion] = useState(1)
  const [isNewPreset, setIsNewPreset] = useState(false)
  const [savingPreset, setSavingPreset] = useState(false)

  const loadRules = useCallback(async () => {
    try {
      const res = await window.novelAgent.creativeRule.get({ sessionId })
      setRulesContent(res.content)
      setSavedRulesContent(res.content)
      setRulesVersion(res.version)
    } catch {}
  }, [sessionId])

  const loadSamples = useCallback(async () => {
    try {
      const list = await window.novelAgent.styleSample.list({ sessionId })
      setSamples(list)
      if (list.length > 0 && !selectedSampleId && !isNewSample) {
        setSelectedSampleId(list[0].id)
        setSampleName(list[0].name)
        setSampleTags(list[0].tags.join(', '))
        setSampleContent(list[0].content)
        setSampleVersion(list[0].version)
      }
    } catch {}
  }, [sessionId, selectedSampleId, isNewSample])

  const loadPresets = useCallback(async () => {
    try {
      const list = await window.novelAgent.preset.list({
        sessionId,
        taskType: taskFilter === 'all' ? undefined : taskFilter
      })
      setPresets(list)
      if (list.length > 0 && !selectedPresetId && !isNewPreset) {
        setSelectedPresetId(list[0].id)
        setPresetType(list[0].taskType)
        setPresetName(list[0].name)
        setPresetInstruction(list[0].instruction)
        setPresetVersion(list[0].version)
      }
    } catch {}
  }, [sessionId, taskFilter, selectedPresetId, isNewPreset])

  useEffect(() => {
    if (activeTab === 'rules') void loadRules()
    else if (activeTab === 'samples') void loadSamples()
    else void loadPresets()
  }, [activeTab, loadRules, loadSamples, loadPresets])

  const saveRules = async () => {
    try {
      setSavingRules(true)
      setError('')
      const updated = await window.novelAgent.creativeRule.update({
        sessionId,
        content: rulesContent,
        expectedVersion: rulesVersion
      })
      setRulesContent(updated.content)
      setSavedRulesContent(updated.content)
      setRulesVersion(updated.version)
    } catch (err) {
      setError(errorText(err, '保存创作规则失败'))
    } finally {
      setSavingRules(false)
    }
  }

  const selectSample = (s: StyleSample) => {
    setIsNewSample(false)
    setSelectedSampleId(s.id)
    setSampleName(s.name)
    setSampleTags(s.tags.join(', '))
    setSampleContent(s.content)
    setSampleVersion(s.version)
    setError('')
  }

  const startNewSample = () => {
    setIsNewSample(true)
    setSelectedSampleId(null)
    setSampleName('新建风格样本')
    setSampleTags('')
    setSampleContent('')
    setSampleVersion(1)
    setError('')
  }

  const saveSample = async () => {
    try {
      setSavingSample(true)
      setError('')
      const tags = sampleTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
      if (isNewSample) {
        const created = await window.novelAgent.styleSample.create({
          sessionId,
          name: sampleName,
          content: sampleContent,
          tags
        })
        setIsNewSample(false)
        setSelectedSampleId(created.id)
        setSampleVersion(created.version)
      } else if (selectedSampleId) {
        const updated = await window.novelAgent.styleSample.update({
          sessionId,
          sampleId: selectedSampleId,
          name: sampleName,
          content: sampleContent,
          tags,
          expectedVersion: sampleVersion
        })
        setSampleVersion(updated.version)
      }
      await loadSamples()
    } catch (err) {
      setError(errorText(err, '保存风格样本失败'))
    } finally {
      setSavingSample(false)
    }
  }

  const deleteSample = async () => {
    if (!selectedSampleId || isNewSample) return
    try {
      setError('')
      await window.novelAgent.styleSample.delete({
        sessionId,
        sampleId: selectedSampleId,
        expectedVersion: sampleVersion
      })
      setSelectedSampleId(null)
      await loadSamples()
    } catch (err) {
      setError(errorText(err, '删除风格样本失败'))
    }
  }

  const selectPreset = (p: InstructionPreset) => {
    setIsNewPreset(false)
    setSelectedPresetId(p.id)
    setPresetType(p.taskType)
    setPresetName(p.name)
    setPresetInstruction(p.instruction)
    setPresetVersion(p.version)
    setError('')
  }

  const startNewPreset = () => {
    setIsNewPreset(true)
    setSelectedPresetId(null)
    setPresetType(taskFilter === 'all' ? 'continue' : taskFilter)
    setPresetName('新建指令预设')
    setPresetInstruction('')
    setPresetVersion(1)
    setError('')
  }

  const savePreset = async () => {
    try {
      setSavingPreset(true)
      setError('')
      if (isNewPreset) {
        const created = await window.novelAgent.preset.create({
          sessionId,
          taskType: presetType,
          name: presetName,
          instruction: presetInstruction
        })
        setIsNewPreset(false)
        setSelectedPresetId(created.id)
        setPresetVersion(created.version)
      } else if (selectedPresetId) {
        const updated = await window.novelAgent.preset.update({
          sessionId,
          presetId: selectedPresetId,
          name: presetName,
          instruction: presetInstruction,
          expectedVersion: presetVersion
        })
        setPresetVersion(updated.version)
      }
      await loadPresets()
    } catch (err) {
      setError(errorText(err, '保存指令预设失败'))
    } finally {
      setSavingPreset(false)
    }
  }

  const deletePreset = async () => {
    if (!selectedPresetId || isNewPreset) return
    try {
      setError('')
      await window.novelAgent.preset.delete({
        sessionId,
        presetId: selectedPresetId,
        expectedVersion: presetVersion
      })
      setSelectedPresetId(null)
      await loadPresets()
    } catch (err) {
      setError(errorText(err, '删除指令预设失败'))
    }
  }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
      <motion.div ref={dialogRef} className="creative-dialog" role="dialog" aria-modal="true" aria-labelledby="creative-title" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2 id="creative-title">创作配置管理</h2>
            <p>维护全书长期创作规则、写作风格样本以及各任务分类指令预设。</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>

        <div className="tab-filter-bar">
          <div className="tab-chips">
            <button className={`tab-chip ${activeTab === 'rules' ? 'active' : ''}`} onClick={() => setActiveTab('rules')}>
              <Sliders size={14} />全书创作规则
            </button>
            <button className={`tab-chip ${activeTab === 'samples' ? 'active' : ''}`} onClick={() => setActiveTab('samples')}>
              <Tag size={14} />风格样本 ({samples.length})
            </button>
            <button className={`tab-chip ${activeTab === 'presets' ? 'active' : ''}`} onClick={() => setActiveTab('presets')}>
              <Sparkles size={14} />指令预设 ({presets.length})
            </button>
          </div>
        </div>

        {error && <p className="inline-error dialog-error">{error}</p>}

        {activeTab === 'rules' && (
          <div className="creative-rules-pane">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: '#4b5563' }}>
                长期规则在所有生成任务中默认注入且优先级仅次于系统约束 (版本 v{rulesVersion})
              </span>
              <button className="primary-button" disabled={isReadOnly || savingRules || rulesContent === savedRulesContent} onClick={() => void saveRules()}>
                <Check size={14} />{savingRules ? '保存中...' : rulesContent === savedRulesContent ? '已保存' : '保存规则'}
              </button>
            </div>
            <textarea
              value={rulesContent}
              disabled={isReadOnly}
              onChange={(e) => setRulesContent(e.target.value)}
              placeholder="请输入全书长期有效的题材设定、人物禁忌、文风要求等硬性创作规则..."
            />
          </div>
        )}

        {activeTab === 'samples' && (
          <div className="creative-body">
            <aside className="creative-sidebar">
              <div className="sidebar-header">
                <span>风格样本列表</span>
                <IconButton label="新建风格样本" onClick={startNewSample} disabled={isReadOnly}>
                  <Plus size={15} />
                </IconButton>
              </div>
              <div className="entry-list">
                {samples.map((s) => (
                  <button
                    key={s.id}
                    className={`entry-card ${!isNewSample && selectedSampleId === s.id ? 'active' : ''}`}
                    onClick={() => selectSample(s)}
                  >
                    <div className="entry-card-header">
                      <span className="entry-card-title">{s.name}</span>
                      <span className="entry-card-meta">v{s.version}</span>
                    </div>
                    <span className="entry-card-preview">{s.content || '无正文'}</span>
                  </button>
                ))}
              </div>
            </aside>
            <main className="creative-detail">
              {(selectedSampleId || isNewSample) ? (
                <>
                  <div className="detail-header">
                    <h2>{isNewSample ? '新建风格样本' : sampleName}</h2>
                    {!isNewSample && <span className="entry-card-meta">版本 v{sampleVersion}</span>}
                  </div>
                  <div className="detail-form">
                    <div className="form-row">
                      <div className="form-field">
                        <label>样本名称</label>
                        <input value={sampleName} onChange={(e) => setSampleName(e.target.value)} placeholder="例如：打斗高潮、细腻心理" />
                      </div>
                      <div className="form-field">
                        <label>标签 (逗号分隔)</label>
                        <input value={sampleTags} onChange={(e) => setSampleTags(e.target.value)} placeholder="打斗, 仙侠, 豪放" />
                      </div>
                    </div>
                    <div className="form-field" style={{ flex: 1 }}>
                      <label>参考文本正文</label>
                      <textarea
                        style={{ minHeight: 220 }}
                        value={sampleContent}
                        onChange={(e) => setSampleContent(e.target.value)}
                        placeholder="输入示范正文片段..."
                      />
                    </div>
                    <div className="form-actions">
                      <div>
                        {!isNewSample && (
                          <button type="button" className="text-button" style={{ color: '#b91c1c' }} onClick={() => void deleteSample()}>
                            <Trash2 size={14} />删除样本
                          </button>
                        )}
                      </div>
                      <button className="primary-button" disabled={isReadOnly || savingSample || !sampleName.trim()} onClick={() => void saveSample()}>
                        <Check size={14} />{savingSample ? '保存中...' : '保存样本'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="empty-hint" style={{ margin: 'auto' }}>请选择或新建一个风格样本</p>
              )}
            </main>
          </div>
        )}

        {activeTab === 'presets' && (
          <div className="creative-body">
            <aside className="creative-sidebar">
              <div className="sidebar-header">
                <span>指令预设列表</span>
                <IconButton label="新建指令预设" onClick={startNewPreset} disabled={isReadOnly}>
                  <Plus size={15} />
                </IconButton>
              </div>
              <div className="sidebar-search">
                <select
                  style={{ width: '100%', fontSize: 12, padding: '4px' }}
                  value={taskFilter}
                  onChange={(e) => setTaskFilter(e.target.value as typeof taskFilter)}
                >
                  <option value="all">全部任务类型</option>
                  <option value="continue">续写 (continue)</option>
                  <option value="rewrite">重写 (rewrite)</option>
                  <option value="polish">润色 (polish)</option>
                  <option value="knowledge">知识分析 (knowledge)</option>
                  <option value="report">文学报告 (report)</option>
                  <option value="chat">项目问答 (chat)</option>
                </select>
              </div>
              <div className="entry-list">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    className={`entry-card ${!isNewPreset && selectedPresetId === p.id ? 'active' : ''}`}
                    onClick={() => selectPreset(p)}
                  >
                    <div className="entry-card-header">
                      <span className="entry-card-title">{p.name}</span>
                      <span className="source-tag chapter_chunk">{taskTypeLabel[p.taskType]}</span>
                    </div>
                    <span className="entry-card-preview">{p.instruction || '无指令'}</span>
                  </button>
                ))}
              </div>
            </aside>
            <main className="creative-detail">
              {(selectedPresetId || isNewPreset) ? (
                <>
                  <div className="detail-header">
                    <h2>{isNewPreset ? '新建指令预设' : presetName}</h2>
                    {!isNewPreset && <span className="entry-card-meta">版本 v{presetVersion}</span>}
                  </div>
                  <div className="detail-form">
                    <div className="form-row">
                      <div className="form-field">
                        <label>任务分类</label>
                        <select
                          value={presetType}
                          onChange={(e) => setPresetType(e.target.value as typeof presetType)}
                        >
                          <option value="continue">续写 (continue)</option>
                          <option value="rewrite">重写 (rewrite)</option>
                          <option value="polish">润色 (polish)</option>
                          <option value="knowledge">知识分析 (knowledge)</option>
                          <option value="report">文学报告 (report)</option>
                          <option value="chat">项目问答 (chat)</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label>预设名称</label>
                        <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="例如：战斗场面强化" />
                      </div>
                    </div>
                    <div className="form-field" style={{ flex: 1 }}>
                      <label>指令模板内容</label>
                      <textarea
                        style={{ minHeight: 220 }}
                        value={presetInstruction}
                        onChange={(e) => setPresetInstruction(e.target.value)}
                        placeholder="输入在执行对应任务时使用的指令提示词模板..."
                      />
                    </div>
                    <div className="form-actions">
                      <div>
                        {!isNewPreset && (
                          <button type="button" className="text-button" style={{ color: '#b91c1c' }} onClick={() => void deletePreset()}>
                            <Trash2 size={14} />删除预设
                          </button>
                        )}
                      </div>
                      <button className="primary-button" disabled={isReadOnly || savingPreset || !presetName.trim()} onClick={() => void savePreset()}>
                        <Check size={14} />{savingPreset ? '保存中...' : '保存预设'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="empty-hint" style={{ margin: 'auto' }}>请选择或新建一个指令预设</p>
              )}
            </main>
          </div>
        )}

        <footer className="dialog-footer">
          <span>创作配置修改后自动递增 revision 并同步检索</span>
          <button type="button" className="text-button" onClick={onClose}>关闭</button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
