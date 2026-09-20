const { parentPort } = require('node:worker_threads')

function lcs(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return []

  const totalCells = (m + 1) * (n + 1)
  if (totalCells > 16000000) {
    return []
  }

  const stride = n + 1
  const dp = new Int32Array(totalCells)

  for (let i = 1; i <= m; i++) {
    const row = i * stride
    const prevRow = (i - 1) * stride
    const ai = a[i - 1]
    for (let j = 1; j <= n; j++) {
      if (ai === b[j - 1]) {
        dp[row + j] = dp[prevRow + (j - 1)] + 1
      } else {
        const up = dp[prevRow + j]
        const left = dp[row + (j - 1)]
        dp[row + j] = up >= left ? up : left
      }
    }
  }

  const matches = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    const row = i * stride
    const prevRow = (i - 1) * stride
    if (a[i - 1] === b[j - 1]) {
      matches.unshift({ aIndex: i - 1, bIndex: j - 1 })
      i--
      j--
    } else if (dp[prevRow + j] >= dp[row + (j - 1)]) {
      i--
    } else {
      j--
    }
  }
  return matches
}

parentPort.on('message', (message) => {
  if (!message) return
  if (message.type === 'ping') {
    parentPort.postMessage({ type: 'pong' })
  } else if (message.type === 'diff') {
    try {
      const origChars = Array.from(message.orig || '')
      const candChars = Array.from(message.cand || '')
      const matches = lcs(origChars, candChars)
      if (message.port) {
        message.port.postMessage({ type: 'diff-result', matches })
      } else {
        parentPort.postMessage({ type: 'diff-result', matches })
      }
    } catch (err) {
      if (message.port) {
        message.port.postMessage({ type: 'diff-error', error: String(err) })
      }
    } finally {
      if (message.sab) {
        const int32 = new Int32Array(message.sab)
        Atomics.store(int32, 0, 1)
        Atomics.notify(int32, 0)
      }
    }
  }
})
