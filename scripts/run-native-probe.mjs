import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const outputPath = resolve(tmpdir(), 'novel-agent-native-probe.json')
const probeEntry = resolve(import.meta.dirname, '..', 'out', 'main', 'probe.cjs')
const child = spawn(process.execPath, [probeEntry, `--native-probe-output=${outputPath}`], { stdio: 'inherit' })
const exitCode = await new Promise((resolveExit) => child.once('exit', (code) => resolveExit(code ?? 1)))
if (exitCode !== 0) process.exit(exitCode)
console.log(await readFile(outputPath, 'utf8'))
