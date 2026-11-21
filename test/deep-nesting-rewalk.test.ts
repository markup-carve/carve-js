import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, lint, parse, treesEqual } from '../src/index.ts'
import { exportDocument } from '../public/export.ts'

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
  it('lints 372 KB of nested fences within the smoke budget', () => {
    const source = nestedFences(128)
    expect(source.length).toBeGreaterThan(360_000)
    let found = 0
    // CPU time keeps the guard useful on a shared runner; the walk per line took 7 s here, the memoized one under 1 s.
    expect(cpuMs(() => { found = lint(source).length })).toBeLessThan(3000)
    expect(found).toBeGreaterThan(0)
  }, 60_000)

  it('lints a 96 KB line of unclosed image openers within the smoke budget', () => {
    const source = `${'[!'.repeat(48 * 1024)}\n`
    expect(cpuMs(() => lint(source))).toBeLessThan(3000)
  }, 60_000)

  // `/[ \t]+$/` rescans a long run of spaces and tabs inside a line from each of its characters.
  it('lints 288 KB of space and tab indentation within the smoke budget', () => {
    const indent = '  \t'.repeat(32000)
    const source = `${indent}[^n]\n${indent}[^n]\n${indent}[^n]\n`
    expect(cpuMs(() => lint(source))).toBeLessThan(3000)
  }, 60_000)

  it('exports a line with 80 KB of inner spaces and tabs to Markdown within the smoke budget', () => {
    const source = `a${' \t'.repeat(40000)}b\n`
    const document = parse(source)
    let output = ''
    expect(cpuMs(() => { output = exportDocument('markdown', document).output })).toBeLessThan(3000)
    expect(output.startsWith('a ')).toBe(true)
  }, 60_000)

  // The linear scan of link-gap-before-destination reports what the pattern it replaced matched.
  it('reports link-gap-before-destination where the old pattern matched', () => {
    const alphabet = ['[', ']', ' ', '\t', '(', ')', 'a', '!', '*']
    let state = 7
    const next = (limit: number): number => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state % limit
    }
    for (let round = 0; round < 3000; round++) {
      let line = 'x '
      const length = 1 + next(24)
      for (let at = 0; at < length; at++) line += alphabet[next(alphabet.length)]
      const expected = [...line.matchAll(/\[([^\]\n]+)\][ \t]+\(([^)\n]*)\)/g)]
        .filter((match) => match[2]!.trim() !== '').map((match) => [match.index, match.index + match[0].length])
      const actual = lint(`${line}\n`).filter((entry) => entry.code === 'link-gap-before-destination')
        .map((entry) => [entry.range?.startOffset, entry.range?.endOffset])
      expect(actual, JSON.stringify(line)).toEqual(expected)
    }
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
