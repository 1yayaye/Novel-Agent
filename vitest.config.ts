import { defineConfig } from 'vitest/config'

// 显式置空，阻止 vitest 加载 vite.config.ts（渲染层构建插件与产物选项不应影响单测）。
export default defineConfig({})
