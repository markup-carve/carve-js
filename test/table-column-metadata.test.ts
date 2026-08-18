import { describe, expect, it } from 'vitest'
import { carveToHtml, lintCarve, listTable, parse } from '../src/index.js'

const rules = (source: string) => lintCarve(source).map((warning) => warning.rule)

describe('table column metadata', () => {
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
    expect(html).toContain('<tfoot><tr><td style="text-align: left; vertical-align: top;">E</td>')
    expect(html).not.toContain('footer-rows=')
  })
})
