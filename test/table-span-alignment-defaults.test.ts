import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, lintCarve, parse, toAstJson } from '../src/index.js'

describe('table span alignment defaults', () => {
  it('groups a header row with a span placeholder into table_head', () => {
    const source = '|= a |<|= b |\n| 1 | 2 | 3 |\n'
    const table = toAstJson(parse(source)).children?.[0]
    expect(table).toMatchObject({ type: 'table', children: [
      { type: 'table_head', children: [{ type: 'table_row' }] },
      { type: 'table_body', children: [{ type: 'table_row' }] },
    ] })
    expect(carveToHtml(source)).toContain('<thead>')
  })

  it('reads a leading-space lone marker as a colspan', () => {
    const source = '|a| <|\n'
    expect(parse(source).children[0]).toMatchObject({ rows: [{ cells: [{}, { span: 'colspan' }] }] })
    expect(carveToHtml(source)).toContain('<td colspan="2">a</td>')
    expect(carveToCarve(source)).toBe('| a | < |\n')
    expect(lintCarve(source)).toEqual([])
    expect(carveToHtml('|a|< |\n')).toContain('<td colspan="2">a</td>')
  })

  it('keeps a header cell containing a span glyph literal', () => {
    const html = carveToHtml('|a|= <|\n|b|= ^|\n')
    expect(html).toContain('<tr><td>a</td><th scope="row">&lt;</th></tr>')
    expect(html).toContain('<tr><td>b</td><th scope="row">^</th></tr>')
  })

  it('sets a native header default only in its starting column', () => {
    const html = carveToHtml('|=> Wide|<|=~ Last|\n|a|b|c|\n')
    expect(html).toContain('<th scope="col" colspan="2" style="text-align: right;">Wide</th>')
    expect(html).toContain('<tr><td style="text-align: right;">a</td><td>b</td><td style="text-align: center;">c</td></tr>')
  })

  it('leaves a covered delimiter column independent', () => {
    const html = carveToHtml('|> Wide|<|~ Last|\n|:--|:--|:--|\n|a|b|c|\n')
    expect(html).toContain('<tr><td style="text-align: right;">a</td><td style="text-align: left;">b</td><td style="text-align: center;">c</td></tr>')
  })

  it('keeps plain cell markers local after header-row promotion', () => {
    const source = '{header-rows=1}\n|> Wide|<|~ Last|\n|a|b|c|\n'
    const html = carveToHtml(source)
    expect(html).toContain('<th scope="col" colspan="2" style="text-align: right;">Wide</th>')
    expect(html).toContain('<tr><td>a</td><td>b</td><td>c</td></tr>')
  })

  it('keeps vertical defaults on the starting column too', () => {
    const html = carveToHtml('|=>^ Wide|<|=~v Last|\n|a|b|c|\n')
    expect(html).toContain('<td style="text-align: right; vertical-align: top;">a</td><td>b</td><td style="text-align: center; vertical-align: bottom;">c</td>')
  })
})
