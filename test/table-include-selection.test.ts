import { describe, expect, it } from 'vitest'
import { expandIncludes, lintCarve, parse, renderHtml, renderMarkdown, resolve } from '../src/index.js'

function run(source: string, payload: string) {
  const result = expandIncludes(parse(source, { positions: true }), source, { resolve: () => payload })
  return { ...result, html: renderHtml(resolve(result.doc)), markdown: renderMarkdown(resolve(result.doc)) }
}

const file = 'Plan,Price,Seats\nBasic,10,2\nPlus,20,4\nTeam,30,8\n'

describe('marked delimited include selection', () => {
  it('selects records and reorders named columns while retaining the original header', () => {
    const result = run('{table}\n{{ data.csv @code:csv @rows:3-4 @cols:"Seats,Plan" }}\n^ Plans', file)
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<th scope="col">Seats</th><th scope="col">Plan</th>')
    expect(result.html).toContain('<td>4</td><td>Plus</td>')
    expect(result.html).not.toContain('Basic')
    expect(result.html).toContain('Plans')
    expect(result.markdown).toContain('| Seats | Plan |')
  })

  it('counts a quoted multiline field as one record', () => {
    const result = run('{table}\n{{ data.csv @code:csv @rows:3-3 }}', 'A,B\n"one\ntwo",x\nthree,y\n')
    expect(result.html).toContain('<td>three</td>')
    expect(result.html).not.toContain('<td>one')
  })

  it('strips a file BOM before record selection', () => {
    const result = run('{table}\n{{ data.csv @code:csv @rows:2-2 @cols:"B,A" }}', '\uFEFFA,B\nx,y\n')
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<td>y</td><td>x</td>')
    const table = result.doc.children[0]
    if (table?.type === 'table') expect(table.rows[0]?.cells[0]?.pos).toMatchObject({ file: 'data.csv', startColumn: 4 })
  })

  it('keeps the file header when @lines selects later physical lines', () => {
    const source = '{table}\n{{ data.csv @code:csv @lines:3-4 }}'
    const result = run(source, file)
    expect(result.html).toContain('<th scope="col">Plan</th>')
    expect(result.html).toContain('<td>Plus</td>')
    expect(result.html).not.toContain('<td>Basic</td>')
    expect(lintCarve(source, { includes: { resolve: () => file } }).map(w => w.rule)).toContain('include-lines-table-rows-hint')
  })

  it('decodes escaped commas and quotes in column names', () => {
    const result = run('{table}\n{{ data.csv @code:csv @cols:"Price\\, net,Plan\\\"s" }}', '"Plan""s","Price, net"\nA,10\n')
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<th scope="col">Price, net</th>')
    expect(result.html).toContain('<th scope="col">Plan"s</th>')
  })

  it('combines physical lines with named columns and keeps included-file positions', () => {
    const result = run('{table}\n{{ data.csv @code:csv @lines:3-3 @cols:"Price,Plan" }}', file)
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<td>20</td><td>Plus</td>')
    const table = result.doc.children[0]
    expect(table?.type).toBe('table')
    if (table?.type === 'table') {
      expect(table.rows[1]?.cells[0]?.pos).toMatchObject({ file: 'data.csv', startLine: 3 })
    }
  })

  it('combines a code region with named columns', () => {
    const source = '{table}\n{{ data.csv @code:csv @region:pick @cols:"Price,Plan" }}'
    const payload = 'Plan,Price\n// #region pick\nBasic,10\n// #endregion pick\n'
    const result = run(source, payload)
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<td>10</td><td>Basic</td>')
    expect(result.html).not.toContain('#region')
  })

  it('accepts numeric columns only without headers', () => {
    const result = run('{table header-rows=0}\n{{ data.csv @code:csv @rows:2-2 @cols:2-3 }}', file)
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<td>10</td><td>2</td>')
    expect(result.html).not.toContain('<thead>')
  })

  it('keeps multiple original header records without repeating a selected header', () => {
    const result = run('{table header-rows=2}\n{{ data.csv @code:csv @rows:2-4 @cols:"Price,Plan" }}', 'Plan,Price\nGroup,Cost\nBasic,10\nTeam,30\n')
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<th scope="col">Price</th><th scope="col">Plan</th>')
    expect(result.html).toContain('<th scope="col">Cost</th><th scope="col">Group</th>')
    expect(result.html).toContain('<td>10</td><td>Basic</td>')
    expect(result.html).not.toContain('<td>Cost</td>')
  })

  it.each([
    ['quote', '> {table}\n> {{ data.csv @code:csv @rows:2-2 @cols:"Price,Plan" }}\n> After.'],
    ['nested quote', '> > {table}\n> > {{ data.csv @code:csv @rows:2-2 @cols:"Price,Plan" }}\n> > After.'],
    ['list', '- {table}\n  {{ data.csv @code:csv @rows:2-2 @cols:"Price,Plan" }}\n\nAfter.'],
  ])('keeps selected tables inside a %s with a sibling', (_name, source) => {
    const result = run(source, file)
    expect(result.warnings).toEqual([])
    expect(result.html).toContain('<td>10</td><td>Basic</td>')
    expect(result.html).toContain('After.')
  })

  it.each([
    ['@rows:0-2', 'include-rows-invalid'],
    ['@rows:5-6', 'include-rows-out-of-range'],
    ['@cols:"Missing"', 'include-cols-invalid'],
    ['@cols:"Plan,Plan"', 'include-cols-duplicate'],
    ['@cols:1-2', 'include-cols-invalid'],
  ])('keeps invalid %s literal', (option, rule) => {
    const source = `{table}\n{{ data.csv @code:csv ${option} }}`
    const result = run(source, file)
    expect(result.warnings.map(w => w.rule)).toContain(rule)
    expect(result.html).toContain('{{ data.csv')
    expect(result.dependencies).toEqual([{ id: 'data.csv', resolved: true }])
  })

  it.each(['@lines:2-3', '@region:part', '#part'])('rejects @rows with the %s selector', other => {
    const source = other.startsWith('#')
      ? `{table}\n{{ data.csv ${other} @code:csv @rows:2-3 }}`
      : `{table}\n{{ data.csv @code:csv @rows:2-3 ${other} }}`
    const result = run(source, file)
    expect(result.warnings.map(w => w.rule)).toContain('include-selection-conflict')
    expect(result.html).toContain('{{ data.csv')
    expect(result.dependencies).toEqual([{ id: 'data.csv', resolved: true }])
  })

  it('rejects table options without a marked delimited block', () => {
    const result = run('{{ data.csv @code:csv @rows:2-3 }}', file)
    expect(result.warnings.map(w => w.rule)).toContain('include-rows-invalid')
    expect(result.html).toContain('{{ data.csv')
  })

  it('projects 1,000 generated row and column selections', () => {
    for (let i = 0; i < 1000; i++) {
      const format = i % 2 === 0 ? 'csv' : 'tsv'
      const separator = format === 'csv' ? ',' : '\t'
      const headerless = i % 3 === 0
      const first = 1 + (i % 5)
      const last = Math.min(6, first + (i % 3))
      const columns = headerless ? [i % 3, i % 3 + 1] : [i % 4, (i + 1) % 4]
      const header = ['A', 'B', 'C', 'D']
      const records = Array.from({ length: 6 }, (_, row) => header.map((_, column) => `r${row + 1}c${column + 1}`))
      const data = [header, ...records].map(row => row.join(separator)).join('\n') + '\n'
      const names = columns.map(column => header[column]).join(',')
      const source = headerless
        ? `{table header-rows=0}\n{{ data.${format} @code:${format} @rows:${first}-${last} @cols:${columns[0]! + 1}-${columns[1]! + 1} }}`
        : `{table}\n{{ data.${format} @code:${format} @rows:${first}-${last} @cols:"${names}" }}`
      const result = run(source, data)
      expect(result.warnings, `variant ${i}`).toEqual([])
      const expected = (headerless ? [header, ...records].slice(first - 1, last)
        : [header, ...records.slice(Math.max(0, first - 2), last - 1)])
        .map(row => columns.map(column => row[column]))
      const table = result.doc.children[0]
      expect(table?.type, `variant ${i}`).toBe('table')
      if (table?.type === 'table') expect(table.rows.map(row => row.cells.map(cell => cell.children?.map(child => child.type === 'text' ? child.value : '').join(''))), `variant ${i}`).toEqual(expected)
    }
  })
})
