import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

describe('pipe-table row counts', () => {
  const source = '{header-rows=2 footer-rows=1}\n| A | B |\n| C | D |\n| E | F |\n| G | H |\n'

  it('partitions explicit head, body, and foot rows', () => {
    const html = carveToHtml(source)
    expect(html).toContain('<thead><tr><th scope="col">A</th><th scope="col">B</th></tr><tr><th scope="col">C</th><th scope="col">D</th></tr></thead>')
    expect(html).toContain('<tbody>\n    <tr><td>E</td><td>F</td></tr>\n  </tbody>')
    expect(html).toContain('<tfoot><tr><td>G</td><td>H</td></tr></tfoot>')
    expect(html).not.toContain('header-rows=')
    expect(html).not.toContain('footer-rows=')
  })

  it('records the partition while preserving native header cells', () => {
    const source = '{header-rows=1 footer-rows=1}\n| A | B |\n|= C | D |\n| E | F |\n'
    const table = parse(source).children[0]
    expect(table.type).toBe('table')
    if (table.type !== 'table') return
    expect(table.rowGroups).toEqual({ headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 })
    expect(carveToHtml(source)).toContain('<th scope="row">C</th>')
  })
})
