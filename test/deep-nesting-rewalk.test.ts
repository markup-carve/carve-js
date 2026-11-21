import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, lint, parse, treesEqual } from '../src/index.ts'

// Nested `::: c` fences, each shorter than the one before, as the fuzz round found them: a document nested to
// the block depth cap, where every line asked its ancestors once per rule.
function nestedFences(copies: number): string {
  const lines: string[] = []
  for (let colons = 75; colons >= 4; colons--) lines.push(`${':'.repeat(colons)} c`)
  return `${lines.join('\n')}\n#[b c\n`.repeat(copies)
}

function cpuMs(work: () => unknown): number {
  const started = process.cpuUsage()
  work()
  const used = process.cpuUsage(started)
  return (used.user + used.system) / 1000
}

describe('deep nesting without a walk per level', () => {
  it('lints 186 KB of nested fences within the smoke budget', () => {
    const source = nestedFences(64)
    expect(source.length).toBeGreaterThan(180_000)
    let found = 0
    // CPU time keeps the guard useful on a shared runner; the walk per line took over 7 s here.
    expect(cpuMs(() => { found = lint(source).length })).toBeLessThan(3000)
    expect(found).toBeGreaterThan(0)
  }, 60_000)

  // C2-W-125 case five: a lone bracket of a nested link is escaped by that link, and the links around it pair
  // the brackets it leaves open or closed.
  const shapes = ['[a [b](u) ]c](v)', '[[a](u)]](v)', '[a [[b](u) c](v)', '[a [b]](u) [c](v)', '[x [a\\]](u) y](v)',
    '*[*a [b ]c](u)*](v)*', '[a [b [c](u) ]d](v) e](w)', '^*[*[[*^*[*[[*^*[*x](u)^]]](u)^]]](u)']
  for (const source of shapes) {
    it(`keeps the tree of ${JSON.stringify(source)} through fmt (C2-W-002)`, () => {
      for (const normalize of [false, true]) {
        const written = formatWithDiagnostics(source, { normalize })
        expect(written.diagnostics).toEqual([])
        expect(treesEqual(parse(written.source), parse(source))).toBe(true)
        expect(formatWithDiagnostics(written.source, { normalize }).source).toBe(written.source)
      }
    })
  }
})
