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

  it('C2-W-099: a run of hyphens of text is planned with every second hyphen escaped', () => {
    const result = formatBy('a -\\-- b\n', 'both')
    expect(result.output.source).toBe('a -\\-- b\n')
    expect(result.stats.differences).toEqual([])
    expect(result.stats.repaired).toBe(0)
  })
})
