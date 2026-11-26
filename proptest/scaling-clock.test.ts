import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import { superlinear } from './scaling.ts'

function threadMs(): number {
  const usage = process.threadCpuUsage()
  return (usage.user + usage.system) / 1000
}

// The worker burns CPU while the main thread blocks, the way V8's background compiler runs beside a call.
const BURNER = `
const { workerData } = require('node:worker_threads')
const flag = new Int32Array(workerData)
const cpu = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000 }
for (;;) {
  Atomics.wait(flag, 0, 0)
  const end = cpu() + flag[1]
  while (cpu() < end) { /* spin */ }
  Atomics.store(flag, 0, 0)
  Atomics.notify(flag, 0)
}
`

// Without a per-thread clock (Node before 23.9) the checks fall back to the process clock and keep this noise.
void test('CPU time spent on another thread during one step is not superlinear growth (carve-js#5201)', {
  skip: typeof process.threadCpuUsage !== 'function',
}, async () => {
  const flag = new Int32Array(new SharedArrayBuffer(8))
  const worker = new Worker(BURNER, { eval: true, workerData: flag.buffer })
  await new Promise((resolve) => worker.once('online', resolve))
  try {
    const base = 100
    const found = superlinear(['model', (source: string) => {
      const end = threadMs() + source.length / 400
      while (threadMs() < end) { /* spin */ }
      if (source.length >= 8 * base) {
        flag[1] = 40
        Atomics.store(flag, 0, 1)
        Atomics.notify(flag, 0)
        Atomics.wait(flag, 0, 1)
      }
    }], (n) => 'x'.repeat(n), base)
    assert.equal(found, null)
  } finally {
    await worker.terminate()
  }
})
