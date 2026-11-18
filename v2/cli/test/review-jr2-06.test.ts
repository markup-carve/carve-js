import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('C2-T-019: diagnostic location work grows with input length', () => {
  const main = join(import.meta.dirname, '../main.ts')
  const time = (n: number): number => {
    const input = '[^a]: x\n\n'.repeat(n)
    const started = performance.now()
    const result = spawnSync(process.execPath, [main, 'diagnostics', '--json', '--no-includes', '-'],
      { input, encoding: 'utf8', maxBuffer: 20_000_000 })
    expect(result.status).toBe(0)
    return performance.now() - started
  }
  time(1000)
  const times = [4000, 8000, 16000].map(time)
  expect(times[2]! / times[0]!, times.map((value) => value.toFixed(1)).join(', ')).toBeLessThan(3.8)
}, 30_000)
