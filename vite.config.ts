import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 渲染层（React）构建配置：产物输出到 out/renderer，由 WinUI 宿主以
// https://novel-agent/ 虚拟主机映射加载。后端 sidecar 由 scripts/build.mjs 用 esbuild 单独打包。
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [tailwindcss(), react({})],
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    minify: true,
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
})
