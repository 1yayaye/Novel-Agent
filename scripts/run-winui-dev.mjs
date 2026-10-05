import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const DEV_SERVER_URL = process.env.NOVEL_AGENT_DEV_URL || 'http://localhost:5173'
const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const WINUI_PROJECT = resolve(PROJECT_ROOT, 'src-winui/NovelAgent.WinUI.csproj')

async function isDevServerActive(url = DEV_SERVER_URL) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(800) })
    return res.status < 500
  } catch {
    return false
  }
}

async function waitForServer(url = DEV_SERVER_URL, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isDevServerActive(url)) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

let viteChild = null
let winuiChild = null

function stopProcessTree(child, label) {
  if (!child || child.killed || !child.pid) return
  console.log(`[winui:dev] Stopping ${label}...`)
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'])
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    // Ignore cleanup error on process exit
  }
}

function cleanup() {
  stopProcessTree(winuiChild, 'WinUI host')
  stopProcessTree(viteChild, 'Vite dev server')
  winuiChild = null
  viteChild = null
}

process.on('SIGINT', () => {
  cleanup()
  process.exit(130)
})

process.on('SIGTERM', () => {
  cleanup()
  process.exit(143)
})

process.on('exit', () => {
  cleanup()
})

console.log(`[winui:dev] Checking Vite dev server at ${DEV_SERVER_URL}...`)
let alreadyRunning = await isDevServerActive(DEV_SERVER_URL)

if (!alreadyRunning) {
  console.log('[winui:dev] Starting Vite dev server in background (rendererOnly)...')
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  viteChild = spawn(npxCmd, ['electron-vite', 'dev', '--rendererOnly'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: { ...process.env }
  })

  viteChild.on('error', (err) => {
    console.error('[winui:dev] Failed to spawn Vite dev server:', err)
  })

  const ready = await waitForServer(DEV_SERVER_URL, 30000)
  if (!ready) {
    console.error('[winui:dev] Timed out waiting for Vite dev server at ' + DEV_SERVER_URL)
    cleanup()
    process.exit(1)
  }
  console.log(`[winui:dev] Vite dev server is ready at ${DEV_SERVER_URL}!`)
} else {
  console.log(`[winui:dev] Reusing active Vite dev server at ${DEV_SERVER_URL}`)
}

console.log('[winui:dev] Launching WinUI 3 host application...')
const dotnetCmd = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'
winuiChild = spawn(
  dotnetCmd,
  ['run', '--project', WINUI_PROJECT, '-p:Platform=x64'],
  {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      NOVEL_AGENT_DEV_URL: DEV_SERVER_URL
    }
  }
)

winuiChild.on('close', (code) => {
  winuiChild = null
  console.log(`[winui:dev] WinUI 3 process exited with code ${code ?? 0}`)
  cleanup()
  process.exit(code ?? 0)
})
