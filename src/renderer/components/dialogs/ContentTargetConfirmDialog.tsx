import React, { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import { AlertTriangle, ShieldCheck, X } from 'lucide-react'
import { ModelConnectionSummary } from '../../../shared/project'
import { IconButton } from '../common/IconButton'
import { errorText } from '../../utils/formatters'
import { getEndpointHost, computeSha256Fingerprint } from '../../utils/crypto'
import { useDialogDismiss } from '../../hooks/useDialogDismiss'

export function ContentTargetConfirmDialog({
  connection,
  onClose,
  onConfirmed
}: {
  connection: ModelConnectionSummary
  onClose: () => void
  onConfirmed: () => void
}) {
  const { dialogRef, backdropProps } = useDialogDismiss({ onClose })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fingerprint, setFingerprint] = useState('')

  const endpointHost = getEndpointHost(connection.baseUrl)

  useEffect(() => {
    void computeSha256Fingerprint(connection.baseUrl, connection.model).then(setFingerprint)
  }, [connection.baseUrl, connection.model])

  const handleConfirm = async () => {
    if (!fingerprint) return
    setSubmitting(true)
    setError('')
    try {
      await window.novelAgent.connection.confirmContentTarget({
        connectionId: connection.id,
        displayedFingerprint: fingerprint
      })
      onConfirmed()
    } catch (err) {
      setError(errorText(err, '确认联网目标失败'))
      setSubmitting(false)
    }
  }

  return (
    <motion.div className="action-dialog-layer" {...backdropProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={dialogRef} className="confirm-target-dialog" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 8, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4 }}>
        <header className="dialog-header">
          <div>
            <h2>确认联网目标端点</h2>
            <p>首次发送小说作品内容至该服务商前需由作者确认</p>
          </div>
          <IconButton label="关闭" onClick={onClose}><X size={18} /></IconButton>
        </header>
        <div className="confirm-target-body">
          <div className="alert-banner warning">
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <span>执行创作、问答、知识分析等任务将把作品正文或世界观上下文发送至下列目标端点。确认后该端点将被信任；若端点或模型变更需重新确认。</span>
          </div>
          <div className="target-info-card">
            <div className="conn-meta-row"><strong>连接名称</strong><span>{connection.name}</span></div>
            <div className="conn-meta-row"><strong>模型 ID</strong><span>{connection.model}</span></div>
            <div className="conn-meta-row"><strong>目标主机</strong><span style={{ color: '#2d5a27', fontWeight: 600 }}>{endpointHost}</span></div>
            <div className="conn-meta-row"><strong>Base URL</strong><span>{connection.baseUrl}</span></div>
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>内容目标指纹 (Fingerprint)</div>
              <div className="target-fingerprint">{fingerprint || '计算中...'}</div>
            </div>
          </div>
          {error && <p className="inline-error">{error}</p>}
        </div>
        <footer className="dialog-footer">
          <button type="button" className="text-button" onClick={onClose}>取消</button>
          <button type="button" className="primary-button" disabled={submitting || !fingerprint} onClick={() => void handleConfirm()}>
            <ShieldCheck size={15} />{submitting ? '确认中...' : '确认并信任该目标端点'}
          </button>
        </footer>
      </motion.div>
    </motion.div>
  )
}
