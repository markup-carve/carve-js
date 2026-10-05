import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

/**
 * A QUOTED LIST ON A DESCRIPTION LEAD DIES WITH ITS QUOTE
 * (markup-carve/carve-js#2540).
 *
 * The container a description body has open is advanced only by the lines the
 * body takes AT its own column, because a line below that column is a lazy
 * continuation and opens nothing. #2538 made one more kind of line the body's
 * OWN block: an over-indented one below a quote that has stopped collecting.
 * Such a line replaces the container too, and the tracker did not hear about
 * it, so a list the quote held stayed open and the flush-left line below folded
 * into a body the oracle has already ended.
 *
 * THE NESTING ORDER IS THE WHOLE QUESTION. The list in `> - ` is the quote's and
 * dies with it; the list in `- > ` is the outer container and outlives the quote
 * it holds. Reading only "the run holds both kinds" moved all 30 of the `- > `
 * shapes off the oracle, and reading `bodyReadsFlush` alone moved 212, because a
 * plain list lead keeps its over-indented block INSIDE the item.
 */

describe('a quoted list on a description lead dies with its quote', () => {
  const bodyTable = [
    '    <table>',
    '      <tbody>',
    '        <tr><td>-</td></tr>',
    '        <tr><td>b</td></tr>',
    '      </tbody>',
    '    </table>',
  ]
  const quoted = (tag: string) => [
    '    <blockquote>',
    `      <${tag}>`,
    '        <li>',
    '          <table>',
    '            <tbody>',
    '              <tr><td>a</td></tr>',
    '            </tbody>',
    '          </table>',
    '        </li>',
    `      </${tag}>`,
    '    </blockquote>',
  ]

  for (const [label, lead, pad, tag] of [
    ['an unordered', ': > - | a |', '      ', 'ul'],
    ['an ordered', ': > 1. | a |', '       ', 'ol'],
  ] as const) {
    it('ends the body after the quote it held, with ' + label + ' list', () => {
      expect(html(':: t\n' + lead + '\n' + pad + '| - |\n' + pad + '| b |\nx\n')).toBe(
        ['<dl>', '  <dt>t</dt>', '  <dd>', ...quoted(tag), ...bodyTable, '  </dd>', '</dl>', '<p>x</p>'].join('\n'),
      )
    })
  }

  it('keeps the body open while the quoted list has taken no body block', () => {
    expect(html(':: t\n: > - | a |\nx\n')).toBe(
      ['<dl>', '  <dt>t</dt>', '  <dd>', ...quoted('ul'), '    <p>x</p>', '  </dd>', '</dl>'].join('\n'),
    )
  })

  it('keeps a PLAIN list lead collecting, over-indented block and all', () => {
    expect(html(':: t\n: - q\n    | - |\n    | b |\nx\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <ul>',
        '      <li>q',
        '        <table>',
        '          <tbody>',
        '            <tr><td>-</td></tr>',
        '            <tr><td>b</td></tr>',
        '          </tbody>',
        '        </table>',
        '      </li>',
        '    </ul>',
        '    <p>x</p>',
        '  </dd>',
        '</dl>',
      ].join('\n'),
    )
  })

  it('keeps an unquoted line as the quote\'s lazy text while its paragraph is open', () => {
    expect(html(':: t\n: > q\n    | - |\n    | b |\nx\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <blockquote><p>q',
        '| - |',
        '| b |',
        'x</p></blockquote>',
        '  </dd>',
        '</dl>',
      ].join('\n'),
    )
  })

  it('leaves the OPPOSITE nesting order where it was [PRE-EXISTING divergence]', () => {
    // `- > ` puts the list outside, so it outlives the quote and this fix must
    // not reach it. The oracle ends the body here and carve-js does not, which
    // was already true before this change and is unmoved by it. Pinned so the
    // asymmetry stays visible rather than silent.
    expect(html(':: t\n: - > | a |\n      | - |\n      | b |\nx\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <ul>',
        '      <li>',
        '        <blockquote>',
        '          <table>',
        '            <tbody>',
        '              <tr><td>a</td></tr>',
        '            </tbody>',
        '          </table>',
        '        </blockquote>',
        '        <table>',
        '          <tbody>',
        '            <tr><td>-</td></tr>',
        '            <tr><td>b</td></tr>',
        '          </tbody>',
        '        </table>',
        '        x',
        '      </li>',
        '    </ul>',
        '  </dd>',
        '</dl>',
      ].join('\n'),
    )
  })
})
