import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { WorkerResponseSchema } from '../shared/worker-message'

export function pingWorker(workerPath = join(__dirname, 'worker.cjs')): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath)
    const timer = setTimeout(() => {
      worker.terminate().catch(() => undefined)
      reject(new Error('Worker ping timed out'))
    }, 5_000)
    worker.once('error', reject)
    worker.once('message', (message: unknown) => {
      clearTimeout(timer)
      worker.terminate().catch(() => undefined)
      WorkerResponseSchema.parse(message)
      resolve()
    })
    worker.postMessage({ type: 'ping' })
  })
}
