import { describe, expect, it } from 'vitest'
import { markdownToCarve, migrateMarkdown, parse, carveToHtml } from '../src/index.js'
import type { Document, BlockNode, ListItem, Table } from '../src/index.js'

// A GFM body row whose every cell is blank has no Carve spelling
// (markup-carve/carve#1954): written out as `| | |` the parser reads a
// paragraph and the table splits in two. The importer drops the row and
// reports the loss rather than inventing a cell (carve-js#1919).

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

// The `path` names the line of the SOURCE the dropped row stood on, which
// carve-php and carve-rs both report (carve-js#2668).
const blank = (cells: number, line: number): Array<string | undefined> =>
  [`Dropped a table row of ${cells} blank cells; Carve spells no row whose every cell is blank`,
    'warning', 'dropped', 'exact', `line:${line}`]

describe('an all-blank row in an imported Markdown table', () => {
  it('is dropped, and the table stays one table', () => {
    const carve = markdownToCarve('| a | b |\n|---|---|\n|   |   |\n| 3 | 4 |\n')
    expect(carve).toBe('|= a |= b |\n| 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['table(2)'])
  })

  it('is reported as a dropped structure', () => {
    expect(drops('| a | b |\n|---|---|\n|   |   |\n| 3 | 4 |\n')).toStrictEqual([
      blank(2, 3),
    ])
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
})

describe('a blank row elsewhere in an imported Markdown table', () => {
  it('is dropped in the header position, and the body stays a table', () => {
    const carve = markdownToCarve('|   |   |\n|---|---|\n| 3 | 4 |\n')
    expect(carve).toBe('| 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['table(1)'])
    expect(drops('|   |   |\n|---|---|\n| 3 | 4 |\n')).toStrictEqual([
      blank(2, 1),
    ])
  })

  it('leaves no table when no row survives', () => {
    expect(markdownToCarve('|   |   |\n|---|---|\n|   |   |\n')).toBe('')
    expect(drops('|   |   |\n|---|---|\n|   |   |\n')).toStrictEqual([
      blank(2, 1),
      blank(2, 3),
    ])
  })

  it('is dropped as the last row', () => {
    const carve = markdownToCarve('| a | b |\n|---|---|\n| 3 | 4 |\n|   |   |\n')
    expect(carve).toBe('|= a |= b |\n| 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['table(2)'])
    expect(drops('| a | b |\n|---|---|\n| 3 | 4 |\n|   |   |\n')).toStrictEqual([
      blank(2, 4),
    ])
  })

  it('is dropped once per consecutive blank row', () => {
    const carve = markdownToCarve('| a | b |\n|---|---|\n|   |   |\n|   |   |\n| 3 | 4 |\n')
    expect(carve).toBe('|= a |= b |\n| 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['table(2)'])
    expect(drops('| a | b |\n|---|---|\n|   |   |\n|   |   |\n| 3 | 4 |\n')).toStrictEqual([
      blank(2, 3),
      blank(2, 4),
    ])
  })

  it('is reported once per table, and counts the cells it lost', () => {
    expect(drops('| a |\n|---|\n|   |\n\n| a | b | c |\n|---|---|---|\n|   |   |   |\n')).toStrictEqual([
      blank(1, 3),
      blank(3, 7),
    ])
  })
})

describe('a blank row in a table a container holds', () => {
  it('is dropped inside a block quote', () => {
    const carve = markdownToCarve('> | a | b |\n> |---|---|\n> |   |   |\n> | 3 | 4 |\n')
    expect(carve).toBe('> |= a |= b |\n> | 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['block_quote[table(2)]'])
    expect(drops('> | a | b |\n> |---|---|\n> |   |   |\n> | 3 | 4 |\n')).toStrictEqual([
      blank(2, 3),
    ])
  })

  it('is dropped inside a list item', () => {
    const carve = markdownToCarve('- | a | b |\n  |---|---|\n  |   |   |\n  | 3 | 4 |\n')
    expect(carve).toBe('- |= a |= b |\n  | 3 | 4 |\n')
    expect(blocks(carve)).toStrictEqual(['list[table(2)]'])
    expect(drops('- | a | b |\n  |---|---|\n  |   |   |\n  | 3 | 4 |\n')).toStrictEqual([
      blank(2, 3),
    ])
  })
})

describe("the dropped row's path", () => {
  it('names the line of the source, not an index into the table', () => {
    expect(drops('# h\n\n| a | b |\n|---|---|\n|   |   |\n| 3 | 4 |\n')).toStrictEqual([
      blank(2, 5),
    ])
  })

  it('counts the reference definitions the importer strips out', () => {
    expect(drops('[r]: /u\n\n| a | b |\n|---|---|\n|   |   |\n')).toStrictEqual([
      blank(2, 5),
    ])
  })

  it('counts the front matter above the table', () => {
    expect(drops('---\ntitle: t\n---\n\n| a | b |\n|---|---|\n|   |   |\n')).toStrictEqual([
      blank(2, 7),
    ])
  })

  it('names the line inside a quote a list item holds', () => {
    expect(drops('p\n\n> - | a | b |\n>   |---|---|\n>   |   |   |\n>   | 3 | 4 |\n')).toStrictEqual([
      blank(2, 5),
    ])
  })

  it('is absent from the diagnostic that reports no position', () => {
    const report = migrateMarkdown('| a | b |\n|---|---|\n|   |   |\n| 3 | 4 |\n').report
    const unverified = report.diagnostics.filter((d) => d.code === 'fidelity-unverified')
    expect(unverified).toHaveLength(1)
    expect(unverified[0]!.path).toBeUndefined()
  })
})
