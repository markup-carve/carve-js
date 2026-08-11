import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

// A definition-list term `::` is a first-class block opener (carve#295): it
// starts only in block position after a paragraph, and at a list item's content
// column a def-list nests.
describe('a definition list is a first-class block opener (carve#295)', () => {
  it('a `::` term starts after a separating blank', () => {
    expect(html("para\n\n:: t\n:  d\n")).toBe(
      '<p>para</p>\n<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>',
    )
  })

  it('a `::` term follows a bounded heading without a blank', () => {
    expect(html('# H\n:: t\n:  d')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <dl>\n    <dt>t</dt>\n    <dd>d</dd>\n  </dl>\n</section>',
    )
  })

  it('an INDENTED `:: ` (below the content column) still folds as lazy text', () => {
    // `RE_DEFLIST_TERM` is column-anchored, so an indented term is text.
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
    expect(html("- one\n+\n:: t\n:  d\n")).toBe(
      '<ul>\n  <li>one\n    <dl>\n      <dt>t</dt>\n      <dd>d</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('interrupts (ends) a list at column 0', () => {
    expect(html("- one\n\n:: t\n:  d\n")).toBe(
      '<ul>\n  <li>one</li>\n</ul>\n<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>',
    )
  })

  // An UNDER-indented `:  def` (one column below the item's content column but
  // still inside the item) attaches as a `<dd>` rather than folding into the
  // term text. carve-rs and carve-php both attach it; carve-js previously
  // folded it (`<dt>t : d</dt>`). Decision D ("lenient - still a definition")
  // aligns all engines UP to attach. An OVER-indented `:  def` still folds
  // (it reaches the item via the content-column dedent, not the lazy path).
  it('an under-indented `:  def` still attaches as a definition (decision D)', () => {
    expect(html("- one\n+\n:: t\n:  d\n")).toBe(
      '<ul>\n  <li>one\n    <dl>\n      <dt>t</dt>\n      <dd>d</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('an under-indented `:  def` attaches inside an ordered item too', () => {
    expect(html("1. one\n+\n:: t\n:  d\n")).toBe(
      '<ol>\n  <li>one\n    <dl>\n      <dt>t</dt>\n      <dd>d</dd>\n    </dl>\n  </li>\n</ol>',
    )
  })

  it('multiple under-indented `:  def` lines each attach as a `<dd>`', () => {
    expect(html("- one\n+\n:: t\n:  d\n:  d2\n")).toBe(
      '<ul>\n  <li>one\n    <dl>\n      <dt>t</dt>\n      <dd>d</dd>\n      <dd>d2</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })
})
