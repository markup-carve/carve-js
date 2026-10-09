import { describe, it, expect } from 'vitest'
import { migrateMarkdown } from '../src/migration.js'
import { parse } from '../src/parse.js'

const rows = (md: string) =>
  migrateMarkdown(md).report.diagnostics.filter((row) => row.code === 'raw-span-whitespace-trimmed')

describe('a raw span that would end a content line in whitespace (markup-carve/carve#2804)', () => {
  it('reports the loss with the fields the ruling names', () => {
    expect(rows('intro\n\n<a href="foo  \nbar">\n')).toEqual([
      {
        code: 'raw-span-whitespace-trimmed',
        message:
          'A raw span ends a content line in whitespace, which Carve drops; the whitespace did not reach the converted source',
        severity: 'warning',
        fidelity: 'degraded',
        confidence: 'exact',
        path: 'line:3',
      },
    ])
  })

  it('reports a tab the same way', () => {
    expect(rows('<a href="foo\t\nbar">\n').map((row) => row.fidelity)).toEqual(['degraded'])
  })

  it('counts the line in the input, not in the array the importer folds', () => {
    // The reference definition is stripped before the body is walked, so an
    // index into the stripped lines would name line 2 here.
    expect(rows('[a]: /x\n\n<a href="foo  \nbar">\n').map((row) => row.path)).toEqual(['line:3'])
  })

  it('stays silent where the whitespace is not at a line end', () => {
    expect(rows('x <a href="foo  bar"> y\n')).toEqual([])
  })

  it('stays silent where the raw span has no trailing whitespace', () => {
    expect(rows('x <a href="foo">\n')).toEqual([])
  })

  it('names a loss the engine really takes', () => {
    const { value } = migrateMarkdown('<a href="foo  \nbar">\n')
    expect(value).toContain('foo  \n')
    expect(JSON.stringify(parse(value))).toContain('<a href=\\"foo\\nbar\\">')
  })

  it('reaches the default loss gate, where a clean document reaches nothing', () => {
    // The gate fails on `degraded` and `dropped` (docs/format-bridges.md), so
    // the row has to be among what it sees rather than merely present.
    const gated = (md: string) =>
      migrateMarkdown(md)
        .report.diagnostics.filter((row) => row.fidelity === 'degraded' || row.fidelity === 'dropped')
        .map((row) => row.code)
    expect(gated('<a href="foo  \nbar">\n')).toContain('raw-span-whitespace-trimmed')
    expect(gated('one two\n')).toEqual([])
  })
})
