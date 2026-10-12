import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: './tests/e2e', testIgnore: ['**/dual-track/**', '**/app.spec.ts'], timeout: 30_000, workers: 1, reporter: 'list' })
