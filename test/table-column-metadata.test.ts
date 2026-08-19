import { describe, expect, it } from 'vitest'
import { carveToHtml, lintCarve, listTable, parse } from '../src/index.js'

const rules = (source: string) => lintCarve(source).map((warning) => warning.rule)

describe('table column metadata', () => {
  it('rejects duplicate axes and reverse-order pairs as a whole', () => {
    expect(carveToHtml('|=<< Note |\n')).toContain('<th scope="col">&lt;&lt; Note</th>')
    expect(parse('|=~> H |\n').children[0]).toMatchObject({
      rows: [{ cells: [{ children: [{ type: 'text', value: '~> H' }] }] }],
    })
  })

  it('requires a horizontal partner for every vertical marker', () => {
    const table = parse('|=^ Top |=v Bottom |=<^ Paired |=v> Reverse |\n').children[0]
    expect(table).toMatchObject({
      rows: [{ cells: [
        { header: true, children: [{ type: 'text', value: '^ Top' }] },
        { header: true, children: [{ type: 'text', value: 'v Bottom' }] },
        { header: true, align: 'left', valign: 'top' },
        { header: true, children: [{ type: 'text', value: 'v> Reverse' }] },
      ] }],
    })
  })

  it('uses question mark to inherit horizontal alignment while overriding vertical', () => {
    const source = '|=>^ H |\n|?v x |\n'
    expect(parse(source).children[0]).toMatchObject({
      rows: [
        { cells: [{ align: 'right', valign: 'top' }] },
        { cells: [{ valign: 'bottom', children: [{ type: 'text', value: 'x' }] }] },
      ],
    })
    expect(carveToHtml(source)).toContain(
      '<td style="text-align: right; vertical-align: bottom;">x</td>',
    )
  })

  it('keeps every other question-mark run visible', () => {
    for (const [source, value] of [['| ? |\n', '?'], ['|v? x |\n', 'v? x'], ['|?< x |\n', '?< x'], ['|^< x |\n', '^< x']]) {
      expect(parse(source).children[0]).toMatchObject({
        rows: [{ cells: [{ children: [{ type: 'text', value }] }] }],
      })
    }
  })

  it('requires a literal space to terminate an alignment run', () => {
    for (const separator of ['\t', '\v', '\f', '\u2000', '\uFEFF']) {
      const cell = parse(`|<${separator}x |\n`).children[0]
      expect(cell).toMatchObject({
        rows: [{ cells: [{ children: [{ type: 'text', value: `<${separator}x` }] }] }],
      })
      expect(cell).not.toMatchObject({ rows: [{ cells: [{ align: 'left' }] }] })
    }

    expect(parse('|< x |\n').children[0]).toMatchObject({
      rows: [{ cells: [{ align: 'left', children: [{ type: 'text', value: 'x' }] }] }],
    })
  })

  it('keeps in-table alignment ahead of the table attribute, per field', () => {
    const source = '{aligns="left" valigns="bottom"}\n|=>^ H |\n| x |\n'
    expect(carveToHtml(source)).toContain(
      '<td style="text-align: right; vertical-align: top;">x</td>',
    )
    expect(rules(source)).toContain('table-column-overlap')
  })

  it('publishes percentages as fractional AST widths', () => {
    const table = parse('{widths="25,75"}\n| a | b |\n').children[0]
    expect(table).toMatchObject({
      type: 'table',
      columns: [{ width: 0.25 }, { width: 0.75 }],
    })
  })

  it('reports all four new lint contracts', () => {
    expect(rules('|>text |\n')).toContain('table-alignment-run-padding')
    expect(rules('{aligns="left"}\n| a | b |\n')).toContain('table-column-arity')
    expect(rules('{widths="60,50"}\n| a | b |\n')).toContain('table-width-total')
    expect(rules('{aligns="left"}\n|=> H |\n')).toContain('table-column-overlap')
  })

  it('renders ListTable columns and a footer through the shared spelling', () => {
    const source = [
      '{header-rows=1 footer-rows=1 aligns="left,right" valigns="top,bottom" widths="30,70"}',
      '::: list-table',
      '- - A',
      '  - B',
      '- - C',
      '  - D',
      '- - E',
      '  - F',
      ':::',
    ].join('\n')
    const html = carveToHtml(source, { extensions: [listTable()] })
    expect(html).toContain('<col style="width: 30%;">')
    expect(html).toContain('<th scope="col" style="text-align: left; vertical-align: top;">A</th>')
    expect(html).toContain('<tfoot>\n    <tr><td style="text-align: left; vertical-align: top;">E</td>')
    expect(html).not.toContain('footer-rows=')
  })
})
