import { describe, expect, it } from 'vitest'
import { markdownToCarve, migrateMarkdown, parse, carveToHtml } from '../src/index.js'
import type { Document, BlockNode, ListItem, Table } from '../src/index.js'

// A GFM body row whose every cell is blank is a row of empty cells, written
// `| |` per cell (CARVE-P9-082, CARVE-P11-056). An all-blank header with no
// alignment is the scaffolding the Markdown writer adds to a headerless table,
// so it is still dropped and reported.

/** Each block's type, with a table's row count and a container's contents. */
const shape = (node: BlockNode | ListItem): string => {
  if (node.type === 'table') return `table(${(node as Table).rows.length})`
  const children =
    (node as { children?: BlockNode[] }).children ?? (node as { items?: BlockNode[] }).items
  if (!children) return node.type
  const inner = children.map(shape).join(',')
  return node.type === 'list_item' ? inner : `${node.type}[${inner}]`
}

const blocks = (carve: string): string[] => (parse(carve) as Document).children.map(shape)

const drops = (markdown: string): Array<Array<string | undefined>> =>
  migrateMarkdown(markdown).report.diagnostics
    .filter((d) => d.code === 'structure-unspellable')
    .map((d) => [d.message, d.severity, d.fidelity, d.confidence, d.path])

// The `path` names the line of the SOURCE the dropped header stood on, which
// carve-php and carve-rs both report (carve-js#2668).
const header = (cells: number, line: number): Array<string | undefined> =>
  [`Dropped an empty table header of ${cells} blank cells; it is the scaffolding a Markdown writer adds to a headerless table`,
    'warning', 'dropped', 'exact', `line:${line}`]

describe('an all-blank body row in an imported Markdown table', () => {
  it('is kept, and the table stays one table', () => {
    const carve = markdownToCarve('| a | b |\n|---|---|\n|   |   |\n| 3 | 4 |\n')
    expect(carve).toBe('|= a |= b |\n| | |\n| 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['table(3)'])
    expect(carveToHtml(carve)).toContain('<tr><td></td><td></td></tr>')
  })

  it('is not reported as a loss', () => {
    expect(drops('| a | b |\n|---|---|\n|   |   |\n| 3 | 4 |\n')).toStrictEqual([])
    const unverified = migrateMarkdown('| a | b |\n|---|---|\n|   |   |\n| 3 | 4 |\n').report.diagnostics
      .filter((d) => d.code === 'fidelity-unverified')
    expect(unverified).toStrictEqual([])
  })

  it('leaves a row with one non-blank cell alone', () => {
    const carve = markdownToCarve('| a | b |\n|---|---|\n|   | 4 |\n')
    expect(carve).toBe('|= a |= b |\n| | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['table(2)'])
    expect(drops('| a | b |\n|---|---|\n|   | 4 |\n')).toStrictEqual([])
  })

  it('keeps a backslash before trailing cell spaces literal', () => {
    const carve = markdownToCarve('| a | b |\n|---|---|\n| \\  | \\  |\n')
    expect(carve).toBe('|= a |= b |\n| \\\\ | \\\\ |\n')
    expect(carveToHtml(carve)).toContain('<td>\\</td>')
  })

  it('is kept as the last row and once per consecutive blank row', () => {
    expect(markdownToCarve('| a | b |\n|---|---|\n| 3 | 4 |\n|   |   |\n')).toBe('|= a |= b |\n| 3 | 4 |\n| | |\n')
    const carve = markdownToCarve('| a | b |\n|---|---|\n|   |   |\n|   |   |\n| 3 | 4 |\n')
    expect(carve).toBe('|= a |= b |\n| | |\n| | |\n| 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['table(4)'])
  })

  it('keeps one slot per column', () => {
    expect(markdownToCarve('| a |\n|---|\n|   |\n\n| a | b | c |\n|---|---|---|\n|   |   |   |\n'))
      .toBe('|= a |\n| |\n\n|= a |= b |= c |\n| | | |\n')
  })
})

describe('an all-blank header in an imported Markdown table', () => {
  it('is dropped, and the body stays a table', () => {
    const carve = markdownToCarve('|   |   |\n|---|---|\n| 3 | 4 |\n')
    expect(carve).toBe('| 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['table(1)'])
    expect(drops('|   |   |\n|---|---|\n| 3 | 4 |\n')).toStrictEqual([header(2, 1)])
  })

  it('is dropped while a blank body row below it is kept', () => {
    expect(markdownToCarve('|   |   |\n|---|---|\n|   |   |\n')).toBe('| | |\n')
    expect(drops('|   |   |\n|---|---|\n|   |   |\n')).toStrictEqual([header(2, 1)])
  })

  it('is kept when it carries column alignment', () => {
    expect(markdownToCarve('|   |   |\n|:--|---|\n| 3 | 4 |\n')).toBe('| | |\n|:---|---|\n| 3 | 4 |\n')
    expect(drops('|   |   |\n|:--|---|\n| 3 | 4 |\n')).toStrictEqual([])
  })
})

describe('a blank row in a table a container holds', () => {
  it('is kept inside a block quote', () => {
    const carve = markdownToCarve('> | a | b |\n> |---|---|\n> |   |   |\n> | 3 | 4 |\n')
    expect(carve).toBe('> |= a |= b |\n> | | |\n> | 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['block_quote[table(3)]'])
  })

  it('is kept inside a list item', () => {
    const carve = markdownToCarve('- | a | b |\n  |---|---|\n  |   |   |\n  | 3 | 4 |\n')
    expect(carve).toBe('- |= a |= b |\n  | | |\n  | 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['list[table(3)]'])
  })
})

describe("the dropped header's path", () => {
  it('names the line of the source, not an index into the table', () => {
    expect(drops('# h\n\n|   |   |\n|---|---|\n| 3 | 4 |\n')).toStrictEqual([header(2, 3)])
  })

  it('counts the reference definitions the importer strips out', () => {
    expect(drops('[r]: /u\n\n|   |   |\n|---|---|\n| 3 | 4 |\n')).toStrictEqual([header(2, 3)])
  })

  it('counts the front matter above the table', () => {
    expect(drops('---\ntitle: t\n---\n\n|   |   |\n|---|---|\n| 3 | 4 |\n')).toStrictEqual([header(2, 5)])
  })

  it('names the line inside a quote a list item holds', () => {
    expect(drops('p\n\n> - |   |   |\n>   |---|---|\n>   | 3 | 4 |\n')).toStrictEqual([header(2, 3)])
  })
})
