import { cp, mkdir, rm, stat, readdir, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const DIST_DIR = resolve(PROJECT_ROOT, 'dist-winui')
const RENDERER_OUT = resolve(PROJECT_ROOT, 'out/renderer')
const RENDERER_DEST = resolve(DIST_DIR, 'renderer')
const SIDECAR_OUT = resolve(PROJECT_ROOT, 'out/main/sidecar.cjs')
const SIDECAR_DEST_DIR = resolve(DIST_DIR, 'sidecar')
const SIDECAR_DEST = resolve(SIDECAR_DEST_DIR, 'index.cjs')
const SIDECAR_CHUNKS_OUT = resolve(PROJECT_ROOT, 'out/main/chunks')
const SIDECAR_CHUNKS_DEST = resolve(SIDECAR_DEST_DIR, 'chunks')
const RUNTIME_MODULES = ['better-sqlite3', 'sqlite-vec', 'sqlite-vec-windows-x64']
const WINUI_PROJ = resolve(PROJECT_ROOT, 'src-winui/NovelAgent.WinUI.csproj')

function runCommand(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  })
  if (result.status !== 0) {
    console.error(`[winui:package] Command failed with exit code ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

async function getDirectorySize(dir) {
  let total = 0
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        total += await getDirectorySize(fullPath)
      } else if (entry.isFile()) {
        const fileStat = await stat(fullPath)
        total += fileStat.size
      }
    }
  } catch {
    // Ignore errors for unreadable items
  }
  return total
}

console.log('====================================================')
console.log('       Novel Agent - WinUI 3 Release Packager       ')
console.log('====================================================')

// Step 1: Build Web/Renderer Assets
console.log('\n[1/3] Building frontend assets (pnpm build)...')
const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
runCommand(pnpmCmd, ['build'])

if (!existsSync(join(RENDERER_OUT, 'index.html'))) {
  console.error('[winui:package] Error: out/renderer/index.html was not generated.')
  process.exit(1)
}

if (!existsSync(SIDECAR_OUT)) {
  console.error(`[winui:package] Error: ${SIDECAR_OUT} was not generated.`)
  process.exit(1)
}

// Step 2: Publish WinUI 3 Application (.NET 8 self-contained x64)
console.log('\n[2/3] Publishing WinUI 3 Host (dotnet publish)...')
const dotnetCmd = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'
runCommand(dotnetCmd, [
  'publish',
  WINUI_PROJ,
  '-c',
  'Release',
  '-p:Platform=x64',
  '-r',
  'win-x64',
  '--self-contained',
  'true',
  '-o',
  DIST_DIR
])

// Step 3: Bundle Renderer Assets into Release Output
console.log('\n[3/3] Copying renderer assets to dist-winui/renderer...')
await cp(RENDERER_OUT, RENDERER_DEST, { recursive: true })
await mkdir(SIDECAR_DEST_DIR, { recursive: true })
await cp(SIDECAR_OUT, SIDECAR_DEST)
if (existsSync(SIDECAR_CHUNKS_OUT)) {
  await cp(SIDECAR_CHUNKS_OUT, SIDECAR_CHUNKS_DEST, { recursive: true })
}
const runtimeModulesDir = resolve(DIST_DIR, 'node_modules')
await mkdir(runtimeModulesDir, { recursive: true })
for (const moduleName of RUNTIME_MODULES) {
  const source = resolve(PROJECT_ROOT, 'node_modules', moduleName)
  if (existsSync(source)) {
    const destination = resolve(runtimeModulesDir, moduleName)
    await rm(destination, { recursive: true, force: true })
    await cp(await realpath(source), destination, { recursive: true })
  }
}
const nestedSqliteVec = resolve(PROJECT_ROOT, 'node_modules/sqlite-vec/sqlite-vec-windows-x64')
const pnpmSqliteVec = resolve(PROJECT_ROOT, 'node_modules/.pnpm/sqlite-vec-windows-x64@0.1.9/node_modules/sqlite-vec-windows-x64')
const sqliteVecSource = existsSync(nestedSqliteVec) ? nestedSqliteVec : pnpmSqliteVec
if (existsSync(sqliteVecSource)) {
  const destination = resolve(runtimeModulesDir, 'sqlite-vec/node_modules/sqlite-vec-windows-x64')
  await rm(destination, { recursive: true, force: true })
  await mkdir(resolve(runtimeModulesDir, 'sqlite-vec/node_modules'), { recursive: true })
  await cp(await realpath(sqliteVecSource), destination, { recursive: true })
}

// Verification of Packaged Structure
console.log('\nValidating release package structure...')
const exePath = join(DIST_DIR, 'NovelAgent.WinUI.exe')
const htmlPath = join(RENDERER_DEST, 'index.html')

if (!existsSync(exePath)) {
  console.error(`[winui:package] Verification failed: ${exePath} missing.`)
  process.exit(1)
}

if (!existsSync(htmlPath)) {
  console.error(`[winui:package] Verification failed: ${htmlPath} missing.`)
  process.exit(1)
}

if (!existsSync(SIDECAR_DEST)) {
  console.error(`[winui:package] Verification failed: ${SIDECAR_DEST} missing.`)
  process.exit(1)
}

if (!existsSync(SIDECAR_CHUNKS_DEST)) {
  console.error(`[winui:package] Verification failed: ${SIDECAR_CHUNKS_DEST} missing.`)
  process.exit(1)
}

for (const moduleName of ['better-sqlite3', 'sqlite-vec']) {
  if (!existsSync(resolve(runtimeModulesDir, moduleName))) {
    console.error(`[winui:package] Verification failed: runtime module ${moduleName} missing.`)
    process.exit(1)
  }
}

if (!existsSync(resolve(runtimeModulesDir, 'sqlite-vec/node_modules/sqlite-vec-windows-x64/vec0.dll'))) {
  console.error('[winui:package] Verification failed: sqlite-vec Windows extension missing.')
  process.exit(1)
}

const exeStat = await stat(exePath)
const totalBytes = await getDirectorySize(DIST_DIR)
const totalMB = (totalBytes / (1024 * 1024)).toFixed(2)

console.log('----------------------------------------------------')
console.log('  WinUI 3 Release Package Verification Succeeded!')
console.log('----------------------------------------------------')
console.log(`- Executable:       ${exePath} (${(exeStat.size / (1024 * 1024)).toFixed(2)} MB)`)
console.log(`- Frontend Assets:  ${RENDERER_DEST}`)
console.log(`- Total Dist Size:  ~${totalMB} MB`)
console.log(`- Output Directory: ${DIST_DIR}`)
console.log('====================================================')
