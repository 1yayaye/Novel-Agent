import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const outputPath = resolve(tmpdir(), 'novel-agent-native-probe.json')
const electron = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron')
const child = spawn(electron, ['.', `--native-probe-output=${outputPath}`], { stdio: 'inherit', shell: process.platform === 'win32' })
const exitCode = await new Promise((resolveExit) => child.once('exit', (code) => resolveExit(code ?? 1)))
if (exitCode !== 0) process.exit(exitCode)
console.log(await readFile(outputPath, 'utf8'))
