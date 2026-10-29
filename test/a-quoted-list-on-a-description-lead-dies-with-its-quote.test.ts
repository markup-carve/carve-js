import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

/** A nested table leaves no paragraph for a below-column line to continue. */
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

  it('ends the body when the quoted list holds only a table', () => {
    expect(html(':: t\n: > - | a |\nx\n')).toBe(
      ['<dl>', '  <dt>t</dt>', '  <dd>', ...quoted('ul'), '  </dd>', '</dl>', '<p>x</p>'].join('\n'),
    )
  })

  it('ends the body after an over-indented table in a plain list', () => {
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
        '  </dd>',
        '</dl>',
        '<p>x</p>',
      ].join('\n'),
    )
  })

  it('closes the quote before a table at the description body column', () => {
    expect(html(':: t\n: > q\n    | - |\n    | b |\nx\n')).toBe(
      [
        '<dl>',
        '  <dt>t</dt>',
        '  <dd>',
        '    <blockquote><p>q</p></blockquote>',
        '    <table>',
        '      <tbody>',
        '        <tr><td>-</td></tr>',
        '        <tr><td>b</td></tr>',
        '      </tbody>',
        '    </table>',
        '  </dd>',
        '</dl>',
        '<p>x</p>',
      ].join('\n'),
    )
  })

  it('ends the item in the opposite nesting order too', () => {
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
        '      </li>',
        '    </ul>',
        '  </dd>',
        '</dl>',
        '<p>x</p>',
      ].join('\n'),
    )
  })
})
