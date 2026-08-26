import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * An abbreviation definition ONE COLUMN BELOW a definition description's
 * content column folds into the description as prose, and does not end the body
 * (markup-carve/carve-js#1544).
 *
 * AN ABBREVIATION DEFINITION IS RECOGNIZED ONLY AT DOCUMENT LEVEL (PART 12 §7),
 * so inside a container the line "is not a definition at all: it is ordinary
 * paragraph text". By the time the below-column question is asked there is no
 * definition to end the body WITH, only prose - and prose below a description's
 * column folds, which the plain-line control below shows.
 *
 * THE SAME DESCRIPTION ALREADY FOLDED IT WHEN NESTED. `startsInterruptingBlock`
 * gates the abbreviation arm on `lexer.atDocumentLevel`, and
 * `parseDefinitionList` runs on the document lexer for a top-level list and on
 * a sub-lexer for one inside a list item - so this engine gave the identical
 * description two answers according to how deep it sat, which is the reading
 * markup-carve/carve#932 refuses. The nested row below is what makes that
 * visible, and it is why the fix waives the arm for this caller rather than
 * widening the gate.
 *
 * The link and footnote spellings must NOT move: those ARE recognized inside a
 * container, so they end the body and their text belongs to the document. They
 * are pinned here as the rows that tell this fix from a blanket one.
 */
describe("an abbreviation definition below a description's column folds", () => {
  const html = (src: string): string => carveToHtml(src)

  it('folds as prose, exactly like the plain line in the same position', () => {
    expect(html(':: t\n:  d\n  *[A]: a\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d\n*[A]: a\ntail</dd>\n</dl>',
    )
  })

  it('CONTROL: the plain line in that position folds', () => {
    expect(html(':: t\n:  d\n  x\ntail\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>d\nx\ntail</dd>\n</dl>')
  })

  it('registers nothing, so a later use site stays literal', () => {
    // The line is description text, and text defines no abbreviation: no
    // `<abbr>` may appear at the use site, and the term must render as written.
    const out = html(':: t\n:  d\n  *[A]: a\ntail\n\nA here\n')
    expect(out).not.toContain('<abbr')
    expect(out).toContain('<p>A here</p>')
  })

  it('answers the same for the nested spelling it already answered', () => {
    // The description inside a list item folded all along. One rule, one answer,
    // whatever the host depth.
    expect(html('- :: t\n  :  d\n   *[A]: a\n  tail\n')).toBe(
      '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>d\n*[A]: a\ntail</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('CONTROLS: the link and footnote spellings still end the body', () => {
    // Recognized inside a container, so they are block openers there and the
    // band ends the body on them. A fix that waived the whole invisible set
    // instead of the abbreviation arm fails exactly here.
    expect(html(':: t\n:  d\n  [r]: /u\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<p>[r]: /u\ntail</p>',
    )
    expect(html(':: t\n:  d\n  [^f]: n\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<p>[^f]: n\ntail</p>',
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
