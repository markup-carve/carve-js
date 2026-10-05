import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

/**
 * AN OVER-INDENTED BLOCK BELOW A QUOTED DESCRIPTION LEAD IS THE BODY'S
 * (markup-carve/carve-js#2536).
 *
 * A quote is reached by its MARKER, so an unquoted line below one is the
 * quote's only as the lazy continuation of an open paragraph. Two gates in this
 * host asked a weaker question instead - whether a quote was tracked at all,
 * and whether the line stood at or past the quote's own column - and both
 * answers claimed every indented line under a quote that had stopped
 * collecting. An over-indented table row below `: > | a |` was therefore never
 * reconsidered as a block of its own: it kept its residual indent and reached
 * the page as prose, and the flush-left line below it folded into that prose
 * rather than leaving the body.
 *
 * The control is a quote whose bottom block DOES leave a paragraph open: there
 * the unquoted line is the quote's lazy text and nothing moves.
 */

describe('an over-indented block below a quoted description lead is the body\'s', () => {
  const quotedTable = [
    '    <blockquote>',
    '      <table>',
    '        <tbody>',
    '          <tr><td>a</td></tr>',
    '        </tbody>',
    '      </table>',
    '    </blockquote>',
  ]
  const bodyTable = [
    '    <table>',
    '      <tbody>',
    '        <tr><td>-</td></tr>',
    '        <tr><td>b</td></tr>',
    '      </tbody>',
    '    </table>',
  ]

  it('starts a fresh table at the body\'s own column', () => {
    expect(html(':: t\n: > | a |\n    | - |\n    | b |\n')).toBe(
      ['<dl>', '  <dt>t</dt>', '  <dd>', ...quotedTable, ...bodyTable, '  </dd>', '</dl>'].join('\n'),
    )
  })

  it('leaves the flush-left line below that table out of the body', () => {
    expect(html(':: t\n: > | a |\n    | - |\n    | b |\nx\n')).toBe(
      ['<dl>', '  <dt>t</dt>', '  <dd>', ...quotedTable, ...bodyTable, '  </dd>', '</dl>', '<p>x</p>'].join('\n'),
    )
  })

  it('reads the rows alike at the body\'s column and one band past it', () => {
    expect(html(':: t\n: > | a |\n  | - |\n  | b |\n')).toBe(html(':: t\n: > | a |\n    | - |\n    | b |\n'))
  })

  it('reads an over-indented quote lead the same way', () => {
    expect(html(':: t\n:   > | a |\n      | - |\n      | b |\n')).toBe(
      ['<dl>', '  <dt>t</dt>', '  <dd>', ...quotedTable, ...bodyTable, '  </dd>', '</dl>'].join('\n'),
    )
  })

  it('keeps an unquoted line as the quote\'s lazy text while its paragraph is open', () => {
    expect(html(':: t\n: > q\n    more\nx\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <blockquote><p>q',
        'more',
        'x</p></blockquote>',
        '  </dd>',
        '</dl>',
      ].join('\n'),
    )
  })
})
