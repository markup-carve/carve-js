import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, lint, parse, render, treesEqual } from '../src/index.ts'
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

/**
 * The same work on plain lines of the same length is the yardstick, so a busy runner slows both sides. Before these
 * fixes the shapes below took 8 to 109 times as long as plain text; after, at most as long.
 */
function expectNearPlain(source: string, work: (input: string) => unknown): void {
  work('warm\n')
  const plain = 'plain words here\n'.repeat(Math.ceil(source.length / 17)).slice(0, source.length)
  const yardstick = cpuMs(() => work(plain))
  expect(cpuMs(() => work(source))).toBeLessThan(4 * yardstick + 200)
}

describe('deep nesting without a walk per level', () => {
  it('lints 372 KB of nested fences about as fast as plain text', () => {
    const source = nestedFences(128)
    expect(source.length).toBeGreaterThan(360_000)
    expectNearPlain(source, lint)
    expect(lint(source).length).toBeGreaterThan(0)
  }, 120_000)

  it('lints a 96 KB line of unclosed image openers about as fast as plain text', () => {
    expectNearPlain(`${'[!'.repeat(48 * 1024)}\n`, lint)
  }, 120_000)

  // `/[ \t]+$/` rescans a long run of spaces and tabs inside a line from each of its characters.
  it('lints 288 KB of space and tab indentation about as fast as plain text', () => {
    const indent = '  \t'.repeat(32000)
    expectNearPlain(`${indent}[^n]\n${indent}[^n]\n${indent}[^n]\n`, lint)
  }, 120_000)

  it('exports a line with 80 KB of inner spaces and tabs to Markdown about as fast as plain text', () => {
    const source = `a${' \t'.repeat(40000)}b\n`
    expectNearPlain(source, (input) => exportDocument('markdown', parse(input)).output)
    expect(exportDocument('markdown', parse(source)).output.startsWith('a ')).toBe(true)
  }, 120_000)

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

describe('long lines without a rescan per position', () => {
  // The escape mask of lint counted the backslashes before every punctuation mark back from it.
  it('lints a 64 KB run of backslashes about as fast as plain text', () => {
    expectNearPlain(`${'\\'.repeat(64 * 1024)}\n`, lint)
  }, 120_000)

  // emphasis-marker-before-attributes looked for the `}` and scanned the block from every `_{`.
  it('lints 64 KB of `_{` before one `}` about as fast as plain text', () => {
    expectNearPlain(`${'_{'.repeat(32 * 1024)}}\n`, lint)
  }, 120_000)

  // A row whose quoted attribute might hold the later pipes scanned for the `}` from every pipe.
  it('parses and lints 64 KB of `|{` about as fast as plain text', () => {
    const source = `${'|{'.repeat(32 * 1024)}\n`
    expectNearPlain(source, parse)
    expectNearPlain(source, lint)
  }, 120_000)

  // The class guard: one line of a short unit repeated, 1 KB against 4 KB. Linear work grows 4 times; the shapes
  // above grew 14 to 16 times before.
  it('keeps parse, render and lint linear on repeated short units', () => {
    const alphabet = ['[', ']', '(', ')', '\\', '{', '}', '<', '_', '|', '!', '`', ' ']
    const units = alphabet.flatMap((first) => [first, ...alphabet.map((second) => first + second)])
    const best = (work: () => unknown, runs: number): number => {
      let fastest = Infinity
      for (let run = 0; run < runs; run++) {
        const started = performance.now()
        work()
        fastest = Math.min(fastest, performance.now() - started)
      }
      return fastest
    }
    const slow: string[] = []
    for (const [name, work] of [['parse', parse], ['render', render], ['lint', lint]] as const) {
      for (const unit of units) {
        for (const suffix of ['', '}', ']']) {
          const line = (size: number): string => `${unit.repeat(Math.ceil(size / unit.length))}${suffix}\n`
          const small = best(() => work(line(1024)), 2)
          if (best(() => work(line(4096)), 2) <= 10 * Math.max(small, 1)) continue
          const again = best(() => work(line(4096)), 3)
          if (again > 10 * Math.max(small, 1)) slow.push(`${name} ${JSON.stringify(unit)}${JSON.stringify(suffix)}: ${small.toFixed(1)} to ${again.toFixed(1)} ms`)
        }
      }
    }
    expect(slow).toEqual([])
  }, 300_000)
})
