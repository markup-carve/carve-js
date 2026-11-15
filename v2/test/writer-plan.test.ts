// The planned writer (write-plan.ts): its tables come from the data files, it decides escapes with no
// parse, and where it decides a group it writes the bytes of the repair of C2-W-089.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateWriterTables } from '../scripts/generate-writer-tables.ts'
import { parseWithLayout } from '../src/api.ts'
import { writeTreeWithStats, type WriterPath } from '../src/write.ts'

const root = join(import.meta.dirname, '..')

interface Example {
  input: string
}

const EXAMPLES = JSON.parse(readFileSync(join(root, 'data/examples.json'), 'utf8')) as Example[]

function formatBy(source: string, path: WriterPath): ReturnType<typeof writeTreeWithStats> {
  const parsed = parseWithLayout(source, { extensions: [] })
  return writeTreeWithStats(parsed.document, { layout: parsed.layout }, path, false)
}

describe('the planned writer', () => {
  it('C2-W-088: src/write-tables.ts is what scripts/generate-writer-tables.ts writes', () => {
    const generated = generateWriterTables((file) => readFileSync(join(root, 'data', file), 'utf8'))
    expect(readFileSync(join(root, 'src/write-tables.ts'), 'utf8')).toBe(generated)
  })

  it('C2-W-010: where the plan decides a group, it writes the bytes of the repair, on every example input', () => {
    const differences: string[] = []
    let planned = 0
    for (const example of EXAMPLES) {
      const stats = formatBy(example.input, 'both').stats
      planned += stats.planned
      differences.push(...stats.differences)
    }
    expect(differences).toEqual([])
    expect(planned).toBeGreaterThan(300)
  })

  it('C2-W-089: a document whose every group the plan decides is written with no parse', () => {
    let documents = 0
    for (const example of EXAMPLES) {
      const stats = formatBy(example.input, 'plan').stats
      if (stats.repaired > 0) continue
      documents++
      expect(stats.parses, example.input).toBe(0)
    }
    expect(documents).toBeGreaterThan(200)
  })

  it('C2-W-089: prose, emphasis, links, lists, quotes, tables and code are planned with no parse', () => {
    const source = [
      '= Title', '', 'A paragraph with *strong*, /emphasis/, `code` and a [link](https://example.org "T").',
      'A second line, with {_underline_} and {^sup^}.', '', '- one', '- two', '', '> quoted', '',
      '| a | b |', '| c | d |', '', '```js', 'x = 1', '```', '',
    ].join('\n')
    const result = formatBy(source, 'plan')
    expect(result.output.source).toBe(source)
    expect(result.stats.repaired).toBe(0)
    expect(result.stats.parses).toBe(0)
  })

  // Each source is written by the plan alone, with the bytes the repair writes.
  const PLANNED: readonly [string, string][] = [
    ['C2-B-006: a marker before a tab is text', '-\ta\n'],
    ['C2-B-020: a list marker inside a quote of an item does not interrupt', '- > a\n  > - b\n'],
    ['C2-B-043: a bare dot before a dot and a space is no marker', '. . . and then silence\n'],
    ['C2-B-092: an attribute-shaped later line is text', 'a\n{.x}\n'],
    ['C2-B-138: a line comment on a later line stays in the paragraph', 'a\n%% c\nb\n'],
    ['C2-B-166: a pipe line without a closing pipe is text', 'a\n| b\n'],
    ['C2-I-065: a bracket pair with nothing glued to it is text', 'x [a] y\n'],
    ['C2-I-073: an autolink of text takes its backslash, a broken one none', '\\<a:b> and <a b>\n'],
    ['C2-I-089: an inline footnote of text takes the backslash on its bracket', 'x ^\\[a] and ^[a\n'],
    ['C2-I-096: a cross-reference of text takes its backslash, an empty one none', '\\</#a> and </#>\n'],
    ['C2-I-104: straight quotes that read as smart quotes', 'a \'b\' c and it\'s, a "b" c\n'],
    ['C2-I-115: an arrow of one hyphen stays as typed', 'a <- b and \\<= c\n'],
    ['C2-I-074: an image sigil before a link of the tree, and before an open bracket', '\\![a](/u) and ![a\n'],
  ]
  for (const [clause, source] of PLANNED) {
    it(`${clause}, planned with no parse`, () => {
      const result = formatBy(source, 'plan')
      expect(result.output.source).toBe(source)
      expect(result.stats.repaired).toBe(0)
      expect(result.stats.parses).toBe(0)
      expect(formatBy(source, 'both').stats.differences).toEqual([])
    })
  }

  it('C2-W-016: a CR before a line end in the value of an atom leaves the group to the repair', () => {
    const parsed = parseWithLayout('x %% c\r', { extensions: [] })
    expect(writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', false).stats.planned).toBe(0)
  })

  it('C2-I-025: an unclosed brace of text behind a braced comment leaves the group to the repair', () => {
    const result = formatBy('x/{%*%}\\{%<a:b>\n', 'both')
    expect(result.output.source).toBe('x/{% * %}\\{%<a:b>\n')
    expect(result.stats.planned).toBe(0)
  })

  it('C2-W-099: a run of hyphens of text is planned with every second hyphen escaped', () => {
    const result = formatBy('a -\\-- b\n', 'both')
    expect(result.output.source).toBe('a -\\-- b\n')
    expect(result.stats.differences).toEqual([])
    expect(result.stats.repaired).toBe(0)
  })
})

// Five shapes that the repair wrote in time above linear: each doubling of the input may at most
// multiply the time of `format` by 2.6 on average. The fastest of five runs is taken against the noise of the machine.
const STRESS_SHAPES: readonly [string, (n: number) => string][] = [
  ['unclosed braced emphasis openers', (n) => ` ${'{/a {/b /} { '.repeat(n)}\n`],
  ['braced strong around code spans', (n) => `${'{*a {*b `c` *} {*a {*b `c`'.repeat(n)}\n`],
  ['prose with marks', (n) => `${'word /em/ *strong* `code` [link](/u) -\\-- '.repeat(n)}end\n`],
  ['paragraphs', (n) => 'A paragraph with a line,\nand a second line.\n\n'.repeat(n)],
  ['table rows', (n) => '| a | b *c* |\n'.repeat(n)],
]

function fastest(source: string): number {
  let best = Infinity
  for (let run = 0; run < 5; run++) {
    const started = performance.now()
    formatBy(source, 'plan')
    best = Math.min(best, performance.now() - started)
  }
  return best
}

describe('time linear in the output', () => {
  for (const [name, shape] of STRESS_SHAPES) {
    it(`C2-W-089: ${name} take time linear in their size`, () => {
      const small = formatBy(shape(50), 'both').stats
      expect(small.repaired).toBe(0)
      expect(small.differences).toEqual([])
      const times = [500, 1000, 2000, 4000].map((n) => fastest(shape(n)))
      // The mean growth per doubling over three doublings, so one noisy step does not decide.
      const perDoubling = Math.cbrt(times[3]! / Math.max(times[0]!, 0.5))
      expect(perDoubling, `${times.map((time) => time.toFixed(1)).join(', ')} ms`).toBeLessThan(2.6)
    })
  }
})

// The two inputs of the property harness that the repair took 2.7 and 23 seconds to format.
describe('the slow inputs of the repair', () => {
  for (const name of ['a4da2114c87f7869', 'b01dcd98fddcd1f4']) {
    it(`C2-W-089: ${name} is planned with no parse and keeps the bytes of the repair`, () => {
      const source = readFileSync(join(root, 'test/fixtures/writer-slow', `${name}.crv`), 'utf8')
      const result = formatBy(source, 'plan')
      expect(result.output.source).toBe(readFileSync(join(root, 'test/fixtures/writer-slow', `${name}.out`), 'utf8'))
      expect(result.stats.repaired).toBe(0)
      expect(result.stats.parses).toBe(0)
      expect(fastest(source)).toBeLessThan(500)
    })
  }
})
