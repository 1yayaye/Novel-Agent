import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'src', 'renderer')
const port = Number(new URL(process.env.NOVEL_AGENT_DEV_URL || 'http://localhost:5173').port || 5173)

const server = await createServer({
  root,
  plugins: [tailwindcss(), react()],
  server: {
    host: 'localhost',
    port,
    strictPort: true
  }
})

await server.listen()
server.printUrls()

const shutdown = async (code = 0) => {
  await server.close()
  process.exit(code)
}

process.once('SIGINT', () => void shutdown(130))
process.once('SIGTERM', () => void shutdown(143))
