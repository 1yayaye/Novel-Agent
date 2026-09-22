import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      minify: true,
      externalizeDeps: {
        exclude: ['zod']
      },
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    build: {
      minify: true,
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    plugins: [react({})],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/')
            if (normalized.includes('/src/renderer/components/dialogs/') && !normalized.includes('ImportPreview')) {
              return 'workbench-dialogs'
            }
          }
        }
      }
    }
  }
})
