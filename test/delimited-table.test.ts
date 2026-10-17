import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml, carveToMarkdown, fromAstJson, lintCarve, parse, renderCarve } from '../src/index.js'

const withoutSourceLocations = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, entry) =>
  key === 'pos' || key === 'srcByteLength' ? undefined : entry))

describe('delimited table fences', () => {
  it('renders CSV as an ordinary captioned table and keeps the source form', () => {
    const source = '{table aligns=left,right,right}\n```csv\nItem,Qty,Price\nApple,12,0.40\n"Pear, green",3,0.55\n```\n^ Stock on hand\n'
    expect(parse(source).children[0]?.type).toBe('table')
    const html = carveToHtml(source)
    expect(html).toContain('<caption>Stock on hand</caption>')
    expect(html).toContain('>Pear, green</td>')
    expect(html).toContain('<th scope="col"')
    const canonical = carveToCarve(source)
    expect(canonical).toBe('{aligns=left,right,right}\n{table}\n```csv\nItem,Qty,Price\nApple,12,0.40\n"Pear, green",3,0.55\n```\n^ Stock on hand\n')
    expect(carveToHtml(canonical)).toBe(html)
  })

  it('keeps TSV fields literal and honors header-rows=0', () => {
    const source = '{table header-rows=0}\n```tsv\nA\tB\n^\t<x>\n```\n'
    const html = carveToHtml(source)
    expect(html).toContain('<td>^</td><td>&lt;x&gt;</td>')
    expect(html).not.toContain('<th')
    expect(carveToCarve(source)).toContain('```tsv')
    expect(carveToCarve(source)).toBe('{header-rows=0}\n{table}\n```tsv\nA\tB\n^\t<x>\n```\n')
    expect(withoutSourceLocations(carveToAstJson(carveToCarve(source)))).toEqual(withoutSourceLocations(carveToAstJson(source)))
  })

  it('retains a quoted newline in one CSV cell', () => {
    const source = '{table}\n```csv\nName,Note\nA,"one\ntwo"\n```\n'
    expect(carveToHtml(source)).toContain('<td>one\ntwo</td>')
    expect(carveToMarkdown(source)).toContain('| A | one two |')
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('keeps the default header when a footer is declared', () => {
    const source = '{table footer-rows=1}\n```csv\nItem,Qty\nApple,2\nTotal,2\n```\n'
    const html = carveToHtml(source)
    expect(html).toContain('<thead>')
    expect(html).toContain('<tfoot>')
    expect(html).toContain('<th scope="col">Item</th>')
    expect(withoutSourceLocations(carveToAstJson(carveToCarve(source)))).toEqual(withoutSourceLocations(carveToAstJson(source)))
  })

  it('uses no implicit header when the footer owns the only row', () => {
    const source = '{table footer-rows=1}\n```csv\nonly\n```\n'
    expect(withoutSourceLocations(carveToAstJson(carveToCarve(source)))).toEqual(withoutSourceLocations(carveToAstJson(source)))
  })

  it('leaves unmarked and malformed fences as code', () => {
    expect(parse('```csv\na,b\n```\n').children[0]?.type).toBe('code_block')
    expect(parse('{table}\n```csv\n"bad\n```\n').children[0]?.type).toBe('code_block')
    for (const body of ['a"b,c', '"a" ,b']) {
      expect(parse(`{table}\n\`\`\`csv\n${body}\n\`\`\`\n`).children[0]?.type).toBe('code_block')
    }
  })

  it('keeps the source form across AST JSON', () => {
    const source = '{table}\n```csv\na,b\n1,2\n```\n'
    const ast = carveToAstJson(source)
    expect(ast.children[0]).toMatchObject({ type: 'table', sourceFormat: 'csv' })
    expect(renderCarve(fromAstJson(ast))).toBe(source)
  })

  it('keeps a single empty record distinct from an empty table', () => {
    const record = '{table}\n```csv\n""\n```\n'
    const empty = '{table}\n```csv\n```\n'
    expect(carveToCarve(record)).toContain('""')
    expect(carveToHtml(carveToCarve(record))).toBe(carveToHtml(record))
    expect(carveToHtml(carveToCarve(empty))).toBe(carveToHtml(empty))
  })

  it('keeps derived header metadata when body rows are declared', () => {
    const source = '{table body-rows=1,1}\n```csv\nh\na\nb\n```\n'
    const table = parse(source).children[0]
    expect(table?.attrs?.keyValues?.['header-rows']).toBeUndefined()
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('keeps the default header with an invalid footer count', () => {
    const source = '{table footer-rows=x}\n```csv\nh\na\n```\n'
    expect(carveToHtml(source)).toContain('<th scope="col">h</th>')
  })

  it('keeps a bare footer count and the caption span', () => {
    const source = '{table footer-rows}\n```csv\nh\nfoot\n```\n^ Caption\n'
    const table = parse(source, { positions: true }).children[0]
    expect(table?.type).toBe('table')
    expect(table?.pos?.endLine).toBe(6)
    expect(carveToCarve(source)).toContain('```csv')
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  it('reports malformed quotes and records wider than the first', () => {
    const rules = (source: string): string[] => lintCarve(source)
      .map(warning => warning.rule).filter(rule => rule.startsWith('delimited-table-'))
    expect(rules('{table}\n```csv\n"bad\n```\n')).toContain('delimited-table-malformed')
    expect(rules('{table}\n```csv\na,b\n1\n2,3,4\n```\n')).toContain('delimited-table-wide-row')
    expect(rules('{table}\n```csv\na,b\n1,2\n```\n')).toEqual([])
    expect(rules('> {table}\n> ```csv\n> "x,y",b\n> 1,2,3\n> ```\n')).toContain('delimited-table-wide-row')
    expect(rules('{table}\n``` csv\na,b\n1,2,3\n```\n')).toContain('delimited-table-wide-row')
    expect(rules('{table}\n```csv\na,b\n1,2\n`````\n^ x,y,z\n')).toEqual([])
  })

  it('keeps repeated blank records and trailing field spaces through formatting', () => {
    for (const source of [
      '{table}\n```csv\na\n\n\nb\n```\n',
      '{table}\n```csv\na,b \n```\n',
      '{table}\n```tsv\na\tb\t\n```\n',
    ]) {
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    }
    expect(carveToCarve('{table}\n```csv\na\n\n```\n')).toContain('```csv\na\n""\n```')
  })
})
