import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (source: string) => carveToHtml(source).replace(/\n\s*/g, '')

// CARVE-P9-013 property 3: each document renders as with its invisible lines removed.
describe('a matched comment span after a term or a description keeps the entry open (markup-carve/carve#4901)', () => {
  it.each([
    [':: t\n: d\n%%%\nc\n%%%\n : d2\n', '<dl><dt>t</dt><dd>d</dd><dd>d2</dd></dl>'],
    [':: t\n%%%\nc\n%%%\n : d2\n', '<dl><dt>t</dt><dd>d2</dd></dl>'],
    ['- :: t\n  :: t2\n  %%%\n  c\n  %%%\n  :  > a\n     > b\n',
      '<ul><li><dl><dt>t</dt><dt>t2</dt><dd><blockquote><p>ab</p></blockquote></dd></dl></li></ul>'],
  ])('%j', (source, html) => {
    expect(flat(source)).toBe(html)
  })
})

describe('a blank before only definitions in a description body loosens the list (markup-carve/carve#4903)', () => {
  it.each([
    '- :: term\n  : payload\n\n    [r]: /u\n- sub\n',
    '- :: term\n  : payload\n\n    *[A]: x\n- sub\n',
    '> - :: term\n>   : payload\n>\n>     [r]: /u\n> - sub\n',
    '- :: term\n  : \tpayload\n\n    [r]: /u\n- sub\n',
  ])('%j', (source) => {
    expect(flat(source)).toContain('<li><p>sub</p></li>')
  })

  it('stays tight when a visible line follows the definition', () => {
    expect(flat('- :: term\n  : payload\n\n    [r]: /u\n    more\n- sub\n')).toContain('<li>sub</li>')
  })
})
