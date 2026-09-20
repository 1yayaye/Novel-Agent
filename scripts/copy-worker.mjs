import { cp, mkdir } from 'node:fs/promises'

await mkdir('out/main', { recursive: true })
await cp('src/worker/index.cjs', 'out/main/worker.cjs')
