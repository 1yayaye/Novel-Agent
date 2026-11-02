import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const isWin = process.platform === 'win32'

// 原生模块外部化：打包产物只含业务代码，原生 .node 文件由 package-winui.mjs 复制真实目录。
// zod 会被打进产物（与旧 electron-vite 行为一致），打包目录无需携带它。
const EXTERNAL = ['better-sqlite3', 'sqlite-vec', '@primno/dpapi']

// 服务层沿用 Vite 的 `?raw` 约定内联 SQL 迁移脚本；esbuild 会剥掉 query 后缀，
// 此插件把 .sql 文件当作字符串常量内联（等价于 Vite 的 ?raw）。
const sqlRawPlugin = {
  name: 'sql-raw',
  setup(build) {
    build.onLoad({ filter: /\.sql$/ }, async (args) => {
      const contents = await readFile(args.path, 'utf8')
      return { contents: `export default ${JSON.stringify(contents)}`, loader: 'js' }
    })
  }
}

const ESBUILD_OPTIONS = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: true,
  external: EXTERNAL,
  plugins: [sqlRawPlugin]
}

function runStep(name, command, args) {
  console.log(`\n[build] ${name}`)
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: isWin
  })
  if (result.status !== 0) {
    console.error(`[build] ${name} failed with exit code ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

runStep('renderer (vite)', 'vite', ['build'])

console.log('\n[build] sidecar (esbuild)')
await build({
  entryPoints: [resolve(PROJECT_ROOT, 'src/main/sidecar-entry.ts')],
  outfile: resolve(PROJECT_ROOT, 'out/main/sidecar.cjs'),
  ...ESBUILD_OPTIONS
})

console.log('[build] native probe (esbuild)')
await build({
  entryPoints: [resolve(PROJECT_ROOT, 'src/main/probe-entry.ts')],
  outfile: resolve(PROJECT_ROOT, 'out/main/probe.cjs'),
  ...ESBUILD_OPTIONS
})

await mkdir(resolve(PROJECT_ROOT, 'out/main'), { recursive: true })
await cp(resolve(PROJECT_ROOT, 'src/worker/index.cjs'), resolve(PROJECT_ROOT, 'out/main/worker.cjs'))
console.log('\n[build] done: out/renderer + out/main/{sidecar.cjs,probe.cjs,worker.cjs}')
