// The planned writer (write-plan.ts): its tables come from the data files, it decides escapes with no
// parse, and where it decides a group it writes the bytes of the repair of C2-W-089.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateWriterTables } from '../scripts/generate-writer-tables.ts'
import { parseWithLayout } from '../src/api.ts'
import { format } from '../src/index.ts'
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

  it('C2-B-010: a CR that other content follows on its line is no line end, and the plan writes it', () => {
    for (const source of ['a\rb\n', '`a\rb`\n', '```\na\rb\n```\n', 'x %% c\rd\n']) {
      const result = formatBy(source, 'both')
      expect(result.stats.planned, source).toBe(1)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    for (const source of ['a\r \nb\n', 'x %% c\r\t\n']) expect(formatBy(source, 'both').stats.planned, source).toBe(0)
  })

  it('C2-B-146, C2-B-149: a caption mark below a line of text or after a blank line is text, and the plan writes it bare', () => {
    for (const source of ['a\n\\^ b\n', '\\^ b\n', 'x\n\n\\^ b\n', '- a\n  \\^ b\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\^', '^'))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // Below a line that holds a node, the line above may be a block of its own, so the repair decides.
    for (const source of ['a *b*\n\\^ c\n', '![i](u)\n\\^ b\n']) expect(formatBy(source, 'both').stats.planned, source).toBe(0)
  })

  it('C2-B-150, C2-B-207: a text `#` of a caption before its number mark keeps its backslash in the formatted source', () => {
    for (const source of ['![b](b.png)\n^ Two \\# more\n', '![b](b.png)\n^ *Figure* 2. Two \\# more\n', '![b](b.png)\n^ a \\#\n']) {
      expect(format(source), source).toBe(source)
      expect(formatBy(source, 'plan').stats.planned, source).toBe(0)
    }
    // Behind the mark every `#` is text (C2-B-207), and a `#` inside markup is no mark.
    for (const source of ['![b](b.png)\n^ Fig # Two # more\n', '![b](b.png)\n^ *a #* b\n']) expect(format(source), source).toBe(source)
  })

  it('C2-B-166, C2-B-167: a pipe line where no pipe can close a row is text, and the plan writes it bare', () => {
    for (const source of ['\\| c | d\n', 'a\n\\| c | d\n', '\\| a |b\n', '\\| a |x %% c\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\|', '|'))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // A brace block or a line comment behind a pipe may make it the closing pipe, so the repair decides.
    for (const source of ['\\| a | {.x}\n', '\\| a |{.x}\n', '\\| a | %% c\n']) {
      expect(formatBy(source, 'both').stats.planned, source).toBe(0)
    }
  })

  it('C2-I-090, C2-I-063: a sigil before a closing brace behind text forms nothing, and the plan writes it bare', () => {
    for (const source of ['a @} b\n', 'a #} b\n', '#} x\n', '@}\n', '{#a#} #} x\n', 'x (#}) y\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    expect(formatBy('*a*#} x\n', 'both').stats.planned).toBe(0)
  })

  it('C2-I-087: a bracket and a caret with no later `]` in the content open nothing, and the plan writes them bare', () => {
    for (const source of ['a \\[^b\n', '*a \\[^b*\n', 'a \\[^\n', 'a \\[^b\n\nc]\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\[', '['))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    expect(formatBy('a \\[^b] c\n', 'both').stats.planned).toBe(0)
  })

  it('C2-I-078, C2-I-079: a label that starts with an at-sign or holds only blanks names no reference, and no bracket is escaped', () => {
    for (const source of ['[a][@]\n', '[[]][@]\n', '[a][@x]\n', '[a][ ]\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
  })

  it('C2-I-028: a brace behind a host with no `}` on its line opens no attribute block, and the plan writes it bare', () => {
    for (const source of ['`a`\\{b\n', '`a`\\{b\nc}\n', '*a*\\{b c\n', '[a](/u)\\{\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\{', '{'))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    expect(formatBy('`a`\\{b}\n', 'both').stats.planned).toBe(0)
  })

  it('C2-B-119, C2-B-196: a colon run glued to a name is text, and the plan writes it bare', () => {
    // C2-B-006: a tab before further text leaves the line text too.
    for (const source of ['a\n\\:::x\n', '\\:::x\n', 'a\n\\::::x\n', '- a\n  \\:::x\n', 'a\n\\:::>\n', 'a\n\\:::\tx\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source.replace('\\:', ':'))
      expect(result.stats.repaired, source).toBe(0)
      expect(result.stats.differences, source).toEqual([])
    }
    // A space or the line end behind the run makes a div line, so the colon keeps its backslash.
    for (const source of ['a\n\\::: x\n', 'a\n\\:::\n']) {
      const result = formatBy(source, 'both')
      expect(result.output.source, source).toBe(source)
      expect(result.stats.repaired, source).toBe(0)
    }
  })

  it('C2-I-025: an unclosed brace of text behind a braced comment is text, and the plan writes it bare', () => {
    const result = formatBy('x/{%*%}\\{%<a:b>\n', 'both')
    expect(result.output.source).toBe('x/{% * %}{%<a:b>\n')
    expect(result.stats.planned).toBe(1)
    expect(result.stats.differences).toEqual([])
  })

  it('C2-B-101: a bullet before a brace leaves the group to the repair', () => {
    const result = formatBy('\\-{[^*} {x=1}[^^]\n', 'both')
    // C2-I-034: the block after the dash is no valid attribute block, so the line opens no item and the dash stays bare.
    expect(result.output.source).toBe('-{[^*} {x=1}[^^]\n')
    expect(result.stats.planned).toBe(0)
  })

  it('C2-W-097: a backslash of text left single before punctuation leaves the group to the repair', () => {
    const result = formatBy('x{%\\\'-\\\\*^[\n', 'both')
    expect(result.output.source).toBe('x{%\\\'-\\\\*^[\n')
    expect(result.stats.planned).toBe(0)
  })

  // `format` writes a planned group with no parse, so a block the plan cannot check goes to the repair, which reports the loss.
  const UNCHECKED_BLOCKS: readonly [string, string, string][] = [
    ['C2-B-158: a paragraph of one display math and no role', '$$`x^', 'field-unspellable'],
    ['C2-B-157: a container on the first line of a footnote', '[^f]: - :::', 'structure-unspellable'],
  ]
  for (const [clause, source, code] of UNCHECKED_BLOCKS) {
    it(`${clause} is left to the repair, which reports ${code}`, () => {
      const parsed = parseWithLayout(source, { extensions: [] })
      const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', false)
      expect(result.stats.planned).toBe(0)
      expect(result.output.diagnostics.map((entry) => entry.code)).toContain(code)
    })
  }

  it('C2-W-099: a run of hyphens of text is planned with every second hyphen escaped', () => {
    const result = formatBy('a -\\-- b\n', 'both')
    expect(result.output.source).toBe('a -\\-- b\n')
    expect(result.stats.differences).toEqual([])
    expect(result.stats.repaired).toBe(0)
  })
})

// Five shapes that the repair wrote in time above linear: each doubling of the input may at most
// multiply the time of the writer by 2.6 on average. The fastest of five runs is taken against the noise of the machine.
const STRESS_SHAPES: readonly [string, (n: number) => string][] = [
  ['unclosed braced emphasis openers', (n) => ` ${'{/a {/b /} { '.repeat(n)}\n`],
  ['braced strong around code spans', (n) => `${'{*a {*b `c` *} {*a {*b `c`'.repeat(n)}\n`],
  ['prose with marks', (n) => `${'word /em/ *strong* `code` [link](/u) -\\-- '.repeat(n)}end\n`],
  ['paragraphs', (n) => 'A paragraph with a line,\nand a second line.\n\n'.repeat(n)],
  ['table rows', (n) => '| a | b *c* |\n'.repeat(n)],
]

/** The fastest of five writes of the parse of `source`; the parse itself is not timed. */
function fastest(source: string): number {
  const parsed = parseWithLayout(source, { extensions: [] })
  let best = Infinity
  for (let run = 0; run < 5; run++) {
    const started = performance.now()
    writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', false)
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
      // One run at the largest size first, so the heap has grown before anything is timed.
      formatBy(shape(4000), 'plan')
      const times = [500, 1000, 2000, 4000].map((n) => fastest(shape(n)))
      // The mean growth per doubling over three doublings, so one noisy step does not decide.
      const perDoubling = Math.cbrt(times[3]! / Math.max(times[0]!, 0.5))
      expect(perDoubling, `${times.map((time) => time.toFixed(1)).join(', ')} ms`).toBeLessThan(2.6)
    })
  }
})

describe('time linear in the number of groups', () => {
  it('C2-W-089: planned and repaired groups that alternate take time linear in their count', () => {
    const shape = (n: number): string => '\\# a\n\n\\- b\n\n'.repeat(n)
    const small = formatBy(shape(10), 'plan').stats
    expect(small.planned).toBeGreaterThan(0)
    expect(small.repaired).toBeGreaterThan(0)
    fastest(shape(4000))
    const times = [500, 1000, 2000, 4000].map((n) => fastest(shape(n)))
    const perDoubling = Math.cbrt(times[3]! / Math.max(times[0]!, 0.5))
    expect(perDoubling, `${times.map((time) => time.toFixed(1)).join(', ')} ms`).toBeLessThan(2.6)
  })
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
