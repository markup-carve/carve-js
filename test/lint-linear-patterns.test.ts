import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasLinearMatcher, linearPattern, type Pattern } from '../lint/linear-patterns.ts'

const TABLES = readFileSync(join(import.meta.dirname, '../lint/data-tables.ts'), 'utf8')

/** Every pattern the generated lint rules hold, as they hold it. */
function compiled(): Array<{ source: string, flags: string, pattern: RegExp | Pattern }> {
  const found = []
  const literal = '"(?:[^"\\\\]|\\\\.)*"'
  const line = new RegExp(`^const K\\d+ = (?:new RegExp\\((${literal}), "(\\w*)"\\)|linearPattern\\((${literal})\\))$`, 'gm')
  for (const match of TABLES.matchAll(line)) {
    if (match[3] !== undefined) {
      const source = JSON.parse(match[3]) as string
      found.push({ source, flags: '', pattern: linearPattern(source) })
    } else {
      const source = JSON.parse(match[1]!) as string
      found.push({ source, flags: match[2]!, pattern: new RegExp(source, match[2]) })
    }
  }
  return found
}

function spans(match: RegExpExecArray | null): unknown {
  if (match === null) return null
  return { index: match.index, text: match[0], groups: { ...match.indices?.groups }, named: { ...match.groups } }
}

function run(pattern: RegExp | Pattern, text: string): number {
  const started = performance.now()
  if (!(pattern instanceof RegExp)) [...pattern.matchAll(text)].forEach(() => undefined)
  else if (pattern.global) [...text.matchAll(pattern)].forEach(() => undefined)
  else pattern.test(text)
  return performance.now() - started
}

/** The times on 1 KB and 4 KB of a shape when they grow past linear, else undefined. */
function growth(pattern: RegExp | Pattern, make: (size: number) => string): string | undefined {
  const small = Math.min(run(pattern, make(1024)), run(pattern, make(1024)))
  if (small < 0.05) return undefined
  const big = Math.min(run(pattern, make(4096)), run(pattern, make(4096)))
  return big > 10 * Math.max(small, 0.1) && big > 3 ? `${small.toFixed(2)} ms to ${big.toFixed(1)} ms` : undefined
}

/** A pseudo-random line of pieces; every fifteenth is a bracketed label with no inner `]`, the shape of a definition. */
function randomLine(pieces: readonly string[], round: number, next: (limit: number) => number): string {
  let text = round % 3 === 0 ? '[' : ''
  const length = next(16)
  const pool = round % 15 === 0 ? pieces.filter((piece) => !piece.includes(']')) : pieces
  for (let at = 0; at < length; at++) text += pool[next(pool.length)]
  if (round % 5 === 0) return `${text}]:`
  return round % 5 === 1 ? `${text}\\` : text
}

describe('linear matchers for lint-model patterns (carve#6297)', () => {
  const linear = compiled().filter((entry) => hasLinearMatcher(entry.source))

  it('stand for the patterns the lint model states', () => {
    expect(new Set(linear.map((entry) => entry.source)).size).toBe(6)
  })

  // Random short lines over the characters and pieces the patterns name.
  it('give the matches, spans and groups of the RegExp they replace', () => {
    const alphabet = ['[', ']', '(', ')', '\\', ' ', '\t', '\n', ':', 'a', '] (', '](', '[a] (b)', ' \t(', '\\\\',
      '<', '>', '!', '-', '/', 'b', '<!--', '-->', '<b>', '</b', '<a x', '<<', '\r']
    let state = 11
    const next = (limit: number): number => {
      state = (state * 1103515245 + 12345) % 2147483648
      return state % limit
    }
    for (const { source } of linear) {
      const pattern = linearPattern(source)
      const sticky = new RegExp(source, 'd')
      const global = new RegExp(source, 'gd')
      let hits = 0
      for (let round = 0; round < 20000; round++) {
        const text = randomLine(alphabet, round, next)
        const label = `${source} ${JSON.stringify(text)}`
        expect(pattern.test(text), label).toBe(sticky.test(text))
        expect(spans(pattern.exec(text)), label).toEqual(spans(sticky.exec(text)))
        expect([...pattern.matchAll(text)].map(spans), label).toEqual([...text.matchAll(global)].map(spans))
        if (sticky.test(text)) hits++
      }
      expect(hits, source).toBeGreaterThan(30)
    }
  })

  // The class guard: a line of one short unit repeated, 2 KB against 16 KB, built from the characters each pattern
  // names. Linear work grows 8 times; the three patterns above grew 40 to 70 times before their matchers.
  it('keeps every lint-model pattern linear on repeated short units', () => {
    const suffixes = ['', ']', ']:', ')']
    const slow: string[] = []
    for (const { source, flags, pattern } of compiled()) {
      const named = [...new Set(source.replace(/\\[dswbDSWB]/g, '').replace(/[A-Za-z0-9]/g, ''))]
      const alphabet = ['a', ' ', '\t', ...named.filter((char) => char !== ' ').slice(0, 14)]
      const units = alphabet.flatMap((first) => [first, ...alphabet.map((second) => first + second)])
      for (const unit of units) {
        for (const suffix of suffixes) {
          // A lead that is no space puts the run inside the line, where a lazy part before a trailing class rescans it.
          for (const lead of ['', 'a']) {
            const grew = growth(pattern, (size) => lead + unit.repeat(Math.ceil(size / unit.length)) + suffix)
            if (grew !== undefined) slow.push(`/${source}/${flags} ${JSON.stringify(lead + unit)}${JSON.stringify(suffix)} ${grew}`)
          }
        }
      }
    }
    expect(slow).toEqual([])
  }, 300_000)
})
