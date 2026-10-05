import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      minify: true,
      externalizeDeps: {
        exclude: ['zod']
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          sidecar: resolve(__dirname, 'src/main/sidecar-entry.ts')
        },
        output: {
          entryFileNames: (chunk) => chunk.name === 'sidecar' ? 'sidecar.cjs' : 'index.js'
        }
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
    plugins: [tailwindcss(), react({})],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/')
            if (
              (normalized.includes('/src/renderer/components/dialogs/') ||
                normalized.includes('/src/renderer/features/dialogs/')) &&
              !normalized.includes('ImportPreview')
            ) {
              return 'workbench-dialogs'
            }
          }
        }
      }
    }
  }
})
