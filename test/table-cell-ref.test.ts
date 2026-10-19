import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, expandIncludes, fromAstJson, lintCarve, parse, renderCarve, renderHtml, resolve } from '../src/index.js'

describe('table cell references', () => {
  it('projects a named CSV value into prose, emphasis and inline code', () => {
    const source = '{table #sales}\n```csv\nQuarter,Revenue\nQ1,120\nQ2,150\n```\n\nQ2: @{#sales["Q2"]["Revenue"]}; *bold @{#sales["Q2"]["Revenue"]}*; @{#sales["Q2"]["Revenue"]}{code}.'
    expect(carveToHtml(source)).toContain('<p>Q2: 150; <strong>bold 150</strong>; <code>150</code>.</p>')
    const wire = carveToAstJson(source)
    expect(wire.children.at(-1)).toMatchObject({ type: 'paragraph', children: expect.arrayContaining([
      expect.objectContaining({ type: 'table_cell_ref', target: 'sales', row: 'Q2', column: 'Revenue', value: '150' }),
    ]) })
    expect(renderCarve(fromAstJson(wire))).toContain('@{#sales["Q2"]["Revenue"]}{code}')
  })

  it('projects from an ordinary pipe table and counts body rows from one', () => {
    const source = '{#sales}\n|= Quarter |= Revenue |\n| Q1 | 120 |\n| Q2 | 150 |\n\nNamed @{#sales["Q2"]["Revenue"]}; numbered @{#sales[2][2]}.'
    expect(carveToHtml(source)).toContain('<p>Named 150; numbered 150.</p>')
  })

  it('uses row-key only when the key is outside the first column', () => {
    const source = '{table #sales row-key=Quarter}\n```csv\nRevenue,Quarter\n120,Q1\n150,Q2\n```\n\n@{#sales["Q2"]["Revenue"]}'
    expect(carveToHtml(source)).toContain('<p>150</p>')
    expect(carveToHtml(source)).not.toContain('row-key=')
  })

  it('keeps selector delimiters inside link labels and pipe cells', () => {
    const source = '{#s}\n|= K |= A\\|B |\n| Q]2 | 150 |\n\n[Value @{#s["Q]2"]["A|B"]}](/report)'
    expect(carveToHtml(source)).toContain('<a href="/report">Value 150</a>')
  })

  it('keeps an escaped reference literal', () => {
    const source = '{#s}\n|= K |= V |\n| Q2 | 150 |\n\n\\@{#s["Q2"]["V"]}'
    expect(carveToHtml(source)).toContain('<p>@{#s["Q2"]["V"]}</p>')
  })

  it('leaves unresolved and cyclic references visible', () => {
    const missing = '{#s}\n|= K |= V |\n| Q2 | 150 |\n\n@{#s["Q3"]["V"]}'
    expect(carveToHtml(missing)).toContain('<p>@{#s["Q3"]["V"]}</p>')
    expect(carveToHtml(missing.replace('@{#s["Q3"]["V"]}', '@{#s["Q3"]["V"]}{code}'))).toContain('@{#s["Q3"]["V"]}{code}')
    expect(lintCarve(missing)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'unresolved-table-cell-ref', data: expect.objectContaining({ reason: 'row key is absent' }) }),
    ]))
    const cycle = '{#s}\n|= K |= V |\n| Q2 | @{#s["Q2"]["V"]} |\n\n@{#s["Q2"]["V"]}'
    expect(carveToHtml(cycle)).toContain('<p>@{#s["Q2"]["V"]}</p>')
  })

  it('recomputes an ingested value and rejects inconsistent source fields', () => {
    const wire = carveToAstJson('{#s}\n|= K |= V |\n| Q2 | 150 |\n\n@{#s["Q2"]["V"]}')
    const ref = (wire.children.at(-1) as { children: Array<Record<string, unknown>> }).children[0]!
    ref.value = 'forged'
    expect(renderHtml(fromAstJson(wire))).toContain('<p>150</p>')
    ref.row = 'Q1'
    expect(() => fromAstJson(wire)).toThrow(/source disagrees/)
  })

  it('follows an included table when its id is renamed', () => {
    const source = '{{ a }}\n\n{{ b }}'
    const files: Record<string, string> = {
      a: '{#sales}\n|= Quarter |= Revenue |\n| Q2 | 120 |',
      b: '{#sales}\n|= Quarter |= Revenue |\n| Q2 | 150 |\n\n@{#sales["Q2"]["Revenue"]}',
    }
    const result = expandIncludes(parse(source, { positions: true }), source, {
      resolve: path => files[path] ?? null,
    })
    expect(renderHtml(resolve(result.doc))).toContain('<p>150</p>')
    expect(renderCarve(result.doc)).toContain('@{#sales-2["Q2"]["Revenue"]}')
  })

  it('projects before heading ids and cross-reference labels are resolved', () => {
    const source = '{#s}\n|= K |= V |\n| Q2 | 150 |\n\n# Rev @{#s["Q2"]["V"]}\n\nSee </#Rev-150>.'
    const html = carveToHtml(source)
    expect(html).toContain('id="Rev-150"')
    expect(html).toContain('href="#Rev-150">Rev 150</a>')
  })

  it('uses the chosen smart typography in projected values', () => {
    const source = '{#s}\n|= K |= V |\n| Q2 | Year\'s |\n\n@{#s["Q2"]["V"]}'
    expect(carveToHtml(source, { smartTypography: false })).toContain('<p>Year\'s</p>')
  })

  it('rejects markup in every named row key and reports malformed selectors', () => {
    const table = '{#s}\n|= K |= V |\n| *Q2* | 150 |\n\n@{#s["Q2"]["V"]}'
    expect(carveToHtml(table)).toContain('<p>@{#s["Q2"]["V"]}</p>')
    expect(lintCarve('@{#s[0][1]}')).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'malformed-table-cell-ref' }),
    ]))
  })
})
