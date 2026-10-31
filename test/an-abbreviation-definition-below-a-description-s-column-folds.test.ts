import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/* The ruling on carve#4412 recognizes an abbreviation definition that misses
 * every content column. A line that still reaches an enclosing item remains
 * text in that item. */
describe("an abbreviation definition below a description's column", () => {
  const html = (src: string): string => carveToHtml(src)

  it('defines when its source column misses the description body', () => {
    expect(html(':: t\n:  d\n  *[A]: a\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('CONTROL: the plain line in that position folds', () => {
    expect(html(':: t\n:  d\n  x\ntail\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>d\nx\ntail</dd>\n</dl>')
  })

  it('registers for a later use site', () => {
    const out = html(':: t\n:  d\n  *[A]: a\ntail\n\nA here\n')
    expect(out).toContain('<p><abbr title="a">A</abbr> here</p>')
  })

  it('answers the same for the nested spelling it already answered', () => {
    // This line misses the description column but reaches the item's column.
    expect(html('- :: t\n  :  d\n   *[A]: a\n  tail\n')).toBe(
      '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>d\n*[A]: a\ntail</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('the link and footnote spellings do not fold here', () => {
    // These rows asserted the OPPOSITE when this file landed - that the two
    // definition spellings ended the body - which was the whole band's answer at
    // the time and is what markup-carve/carve#1809 overturned: §10 I5 makes an
    // invisible line at a nonzero column below the content column lazy paragraph
    // text OF THIS CONTAINER, for every kind. Corpus 430 and 430-2 pin them, and
    // markup-carve/carve-js#1550 is the change that moved them.
    //
    // They are kept here rather than deleted because they are still what tells
    // the abbreviation fix from a blanket one: the abbreviation folds because §7
    // never recognized it in a container, the other two fold because of the
    // column. Two reasons, one answer.
    expect(html(':: t\n:  d\n  [r]: /u\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<p>tail</p>',
    )
    expect(html(':: t\n:  d\n  [^f]: n\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>',
    )
  })

  it('CONTROL: an abbreviation definition at document level is still one', () => {
    // The arm being waived is a CONTAINER-continuation question. At document
    // level, where §7 recognizes the definition, it still interrupts a paragraph
    // and still registers.
    expect(html('para\n*[A]: a\n\nA here\n')).toBe(
      '<p>para</p>\n<p><abbr title="a">A</abbr> here</p>',
    )
  })
})
