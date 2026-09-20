export { count } from '../../shared/text-counter'
export const errorText = (error: unknown, fallback: string) => typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : fallback
export const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
export const formatDate = (ms: number) => new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
