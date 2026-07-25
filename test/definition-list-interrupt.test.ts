import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

// A definition-list term `::` is a first-class block opener (carve#295): it
// interrupts an open paragraph or heading like a heading/quote/fence does, and
// at a list item's content column a def-list nests. This reverses the earlier
// "def-list does not interrupt" rule.
describe('a definition list is a first-class block opener that interrupts (carve#295)', () => {
  it('a `::` term after paragraph text interrupts the paragraph', () => {
    expect(html('para\n:: t\n:  d')).toBe(
      '<p>para</p>\n<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>',
    )
  })

  it('a `::` term after a heading line interrupts the heading', () => {
    expect(html('# H\n:: t\n:  d')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <dl>\n    <dt>t</dt>\n    <dd>d</dd>\n  </dl>\n</section>',
    )
  })

  it('an INDENTED `:: ` (below the content column) still folds as lazy text', () => {
    // `RE_DEFLIST_TERM` is `^`-anchored, so an indented term does not interrupt,
    // matching how heading/quote behave below the content column.
    expect(html('para\n :: t\n :  d')).toBe('<p>para\n:: t\n:  d</p>')
  })

  it('a standalone definition list still parses', () => {
    expect(html(':: t\n:  d')).toBe('<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>')
  })

  it('after a blank line a definition list parses', () => {
    expect(html('x\n\n:: t\n:  d')).toBe(
      '<p>x</p>\n<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>',
    )
  })

  it('nests at a list item content column', () => {
    expect(html('- one\n  :: t\n  :  d')).toBe(
      '<ul>\n  <li>one\n    <dl>\n      <dt>t</dt>\n      <dd>d</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('interrupts (ends) a list at column 0', () => {
    expect(html('- one\n:: t\n:  d')).toBe(
      '<ul>\n  <li>one</li>\n</ul>\n<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>',
    )
  })
})
