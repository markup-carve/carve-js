import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function lintRss(bytes) {
  const script = `import { lint } from './lint/lint.ts'; const found = lint('|'.repeat(${bytes}));
    if (found.length !== 0) process.exit(1); process.stdout.write(String(process.memoryUsage().rss));`
  const run = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30_000,
  })
  expect(run.status, run.stderr).toBe(0)
  return Number(run.stdout)
}

describe('plain cells in a wide pipe table', () => {
  it('keeps lint memory proportional to the source', () => {
    const at64 = lintRss(65_536)
    const at128 = lintRss(131_072)
    expect(at64).toBeLessThan(220 * 1024 * 1024)
    expect(at128).toBeLessThan(256 * 1024 * 1024)
    expect(at128 - at64).toBeLessThan(110 * 1024 * 1024)
  }, 60_000)
})
