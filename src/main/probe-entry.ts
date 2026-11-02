import { runNativeProbe, writeProbeResult } from './native-probe.js'

const outputArg = process.argv.find((argument) => argument.startsWith('--native-probe-output='))
if (!outputArg) {
  console.error('缺少 --native-probe-output=<path> 参数')
  process.exit(2)
}

void (async () => {
  try {
    writeProbeResult(outputArg.slice('--native-probe-output='.length), await runNativeProbe())
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
})()
