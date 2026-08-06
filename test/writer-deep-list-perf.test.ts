import { describe, it, expect } from 'vitest'
import { carveToCarve } from '../src/index.js'
import { perfIt } from './helpers/scaling.js'

// Regression guard for the canonical writer's whitespace trims. They were
// anchored regexes (`/[^\S ]+$/`), which the engine retries from every
// start position before it can fail - quadratic in the string it trims. The
// writer trims whole rendered subtrees, so that cost compounded per nesting
// level: `fmt` on an 80-level list took 88.6s here, against 0.244s in
// carve-php and 0.009s in carve-rs (carve-js#638). The trims are now scans
// from the end, linear in the run they remove.
//
// The document is legal source at every depth below: the parse cap accepts
// 200 levels and every engine PARSES these in milliseconds. Only the writer
// was slow, and `fmt` reaches it from a file on disk.

const ladder = (depth: number): string => {
  const lines: string[] = []
  for (let i = 0; i < depth; i++) lines.push(`${'  '.repeat(i)}- x`)

  return `${lines.join('\n')}\n`
}

describe('the canonical writer on a deep list ladder', () => {
  perfIt('formats 80 levels well inside a second', () => {
    // Warm up: the cold call carries JIT compilation, as every other perf
    // guard in this repo notes.
    carveToCarve(ladder(20))

    const start = performance.now()
    const out = carveToCarve(ladder(80))
    const elapsed = performance.now() - start

    expect(out).toContain('- x')
    // ~0.1s warm. The quadratic form took ~88s, so a generous bound separates
    // them without timing flakiness.
    expect(elapsed).toBeLessThan(5000)
  })

  perfIt('formats the deepest document the parse cap accepts', () => {
    carveToCarve(ladder(20))

    const start = performance.now()
    carveToCarve(ladder(200))
    const elapsed = performance.now() - start

    // The 120-level run never finished while the issue was being written.
    expect(elapsed).toBeLessThan(15000)
  })

  // No ratio guard here on purpose. The writer is STILL superlinear after this
  // fix - ~10x across 100 -> 200 levels - and so are the other engines, which
  // is called out in carve-js#638 as its own question. What regressed was the
  // catastrophic backtracking on top of that, and wall-clock bounds are what
  // separate 0.1s from 88s. A ratio bound tight enough to catch a partial
  // regression would also fail on the healthy build.

  it('trims exactly what the regex form trimmed', () => {
    // The trims are load-bearing, so equivalence matters more than speed. A
    // non-breaking space is CONTENT and has to survive at either end; every
    // other whitespace run at either end goes. Same four answers before and
    // after the rewrite.
    const nbsp = '\u00a0'

    expect(carveToCarve('a  \n')).toBe('a\n')
    expect(carveToCarve('\ta\t\n')).toBe('a\n')
    expect(carveToCarve(`${nbsp}a${nbsp}\n`)).toBe(`${nbsp}a${nbsp}\n`)
    expect(carveToCarve(`a${nbsp}  \n`)).toBe(`a${nbsp}\n`)
  })
})
