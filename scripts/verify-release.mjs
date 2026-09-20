import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execSync, spawn } from 'node:child_process'

const root = process.cwd()
const zipPath = join(root, 'dist', 'Novel-Agent-by-matsuri-0.1.0-win-x64.zip')
const unpackedPath = join(root, 'dist', 'win-unpacked')
const executableName = 'Novel Agent by matsuri.exe'

function run(file, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(file, args, { stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${file} exited with ${code}`)))
  })
}

async function probe(directory, outputName) {
  const outputPath = resolve(tmpdir(), outputName)
  await run(join(directory, executableName), [`--native-probe-output=${outputPath}`])
  const result = JSON.parse(readFileSync(outputPath, 'utf8'))
  if (!result.betterSqlite3 || !result.fts5Trigram || !result.sqliteVec || !result.vecKnn || !result.worker) throw new Error('Packaged native probe failed')
}

// ASAR slimming verification (Ticket 01)
const asarPath = join(unpackedPath, 'resources', 'app.asar')
if (!existsSync(asarPath)) throw new Error(`app.asar not found at ${asarPath}`)
const asarSize = statSync(asarPath).size
const maxAsarBytes = 3 * 1024 * 1024
if (asarSize > maxAsarBytes) {
  throw new Error(`ASAR size exceeds 3MB limit: ${(asarSize / (1024 * 1024)).toFixed(2)}MB (${asarSize} bytes)`)
}
console.log(`ASAR size verified: ${(asarSize / (1024 * 1024)).toFixed(2)}MB (${asarSize} bytes) <= 3MB`)

const asarListOutput = execSync(`npx asar list "${asarPath}"`, { encoding: 'utf8' })
const asarLines = asarListOutput.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
const asarFileCount = asarLines.filter((l) => /\.[a-z0-9]+$/i.test(l) || l.endsWith('LICENSE')).length
if (asarFileCount > 50) {
  throw new Error(`ASAR internal file count exceeds 50 limit: ${asarFileCount}`)
}
console.log(`ASAR file count verified: ${asarFileCount} files <= 50 (total entries: ${asarLines.length})`)

if (existsSync(join(unpackedPath, 'data'))) {
  try { rmSync(join(unpackedPath, 'data'), { recursive: true, force: true }) } catch {}
}
await probe(unpackedPath, 'novel-agent-release-unpacked-probe.json')
try { rmSync(join(unpackedPath, 'data'), { recursive: true, force: true }) } catch {}

const portableExePath = join(root, 'dist', 'Novel-Agent-by-matsuri-0.1.0-win-x64.exe')
if (existsSync(portableExePath)) {
  console.log(`Portable standalone executable verified: ${portableExePath}`)
}

const extraction = mkdtempSync(join(tmpdir(), 'novel-agent-release-'))
try {
  const powershell = existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    : 'powershell.exe'
  await run(powershell, ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extraction.replace(/'/g, "''")}'`])
  if (existsSync(join(extraction, 'data'))) throw new Error('Clean ZIP contains data')
  writeFileSync(join(extraction, 'data-upgrade-marker'), 'keep')
  await run(powershell, ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extraction.replace(/'/g, "''")}' -Force`])
  if (!existsSync(join(extraction, 'data-upgrade-marker'))) throw new Error('ZIP overwrite removed existing data')
  await probe(extraction, 'novel-agent-release-zip-probe.json')
  console.log(`Release verification passed: ${extraction}`)
} finally {
  try { rmSync(extraction, { recursive: true, force: true }) } catch {}
}
