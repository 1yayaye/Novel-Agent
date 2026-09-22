const { parentPort } = require('node:worker_threads')

function lcs(a, b) {
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return []

  const max = m + n
  const offset = max
  let v = new Int32Array(2 * max + 1)
  v[offset + 1] = 0
  const trace = []
  let finalD = max

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const kIndex = offset + k
      let x
      if (k === -d || (k !== d && v[kIndex - 1] < v[kIndex + 1])) {
        x = v[kIndex + 1]
      } else {
        x = v[kIndex - 1] + 1
      }

      let y = x - k
      while (x < m && y < n && a[x] === b[y]) {
        x++
        y++
      }
      v[kIndex] = x

      if (x >= m && y >= n) {
        finalD = d
        break outer
      }
    }
  }

  const matches = []
  let i = m
  let j = n

  for (let d = finalD; d > 0; d--) {
    const previousV = trace[d]
    const k = i - j
    const kIndex = offset + k
    const previousK = k === -d || (k !== d && previousV[kIndex - 1] < previousV[kIndex + 1]) ? k + 1 : k - 1
    const previousI = previousV[offset + previousK]
    const previousJ = previousI - previousK

    while (i > previousI && j > previousJ) {
      matches.push({ aIndex: i - 1, bIndex: j - 1 })
      i--
      j--
    }

    if (i === previousI) {
      j--
    } else {
      i--
    }
  }

  while (i > 0 && j > 0) {
    matches.push({ aIndex: i - 1, bIndex: j - 1 })
    i--
    j--
  }

  return matches.reverse()
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
