import { describe, expect, it } from 'vitest'

import { render } from '../../src/index.ts'
import { listTableExtension, listTableRenderer } from '../../extensions/blocks/list-table.ts'

const h = (source: string): string =>
  render(source, { extensions: [listTableExtension], renderers: { 'carve.listTable': listTableRenderer } }).trim()

describe('list-table column lists and cell marks (carve#6858, C2-X-078)', () => {
  it('writes one col per column, a bare col where widths has no entry, and drops entries past the last column (C2-H-152)', () => {
    expect(h('{widths=40}\n::: list-table\n- - a\n  - b\n:::\n')).toBe([
      '<table>', '  <colgroup>', '    <col style="width: 40%;">', '    <col>', '  </colgroup>',
      '  <tbody>', '    <tr><td>a</td><td>b</td></tr>', '  </tbody>', '</table>',
    ].join('\n'))
    expect(h('{widths="030.50,20,50"}\n::: list-table\n- - a\n:::\n')).toContain('<colgroup>\n    <col style="width: 30.5%;">\n  </colgroup>')
  })

  it('takes a width above 0 and at most 100 only, as a pipe table does (C2-B-212)', () => {
    for (const widths of ['0,50', '100.5', '1e2', '.5', '5.']) {
      expect(h(`{widths="${widths}"}\n::: list-table\n- - a\n:::\n`), widths).not.toContain('colgroup')
    }
  })

  it('folds only ASCII whitespace off a cell value, so a no-break space leaves the column entry', () => {
    expect(h('{aligns=right}\n::: list-table\n- -{align=" left"} a\n:::\n')).toContain('<td style="text-align: right;">a</td>')
    expect(h('{valigns=top}\n::: list-table\n- -{valign=" BaseLine\t"} a\n:::\n')).toContain('<td style="vertical-align: baseline;">a</td>')
  })

  it('reads an empty valigns entry as an invalid list', () => {
    expect(h('{valigns="top,"}\n::: list-table\n- - a\n  - b\n:::\n')).toContain('<tr><td>a</td><td>b</td></tr>')
  })
})
