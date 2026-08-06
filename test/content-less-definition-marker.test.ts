/*
 * A CONTENT-LESS definition marker line closes the open item and stays
 * paragraph text (carve-js#731).
 *
 * `::` and `:` with nothing after them but whitespace are not markers - both
 * marker patterns require content - so the line is prose. This engine folded it
 * into whatever was open instead, because "not a marker" was read as "not a
 * boundary": the term-continuation loop and the definition-body loop each break
 * on a NEW marker, and a content-less one matched neither.
 *
 * carve-rs and carve-php both close. Measured before the change on four shapes;
 * three diverged and the fourth (a bare `::`, with no trailing space) already
 * agreed - which is why the pattern requires at least one space and leaves that
 * line alone.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.replace(/\s+/g, ' ').trim()

describe('a content-less definition marker line', () => {
  it('closes an open term', () => {
    expect(flat(carveToHtml(':: t\n:: \nx\n'))).toBe('<dl> <dt>t</dt> </dl> <p>:: x</p>')
  })

  it('closes an open definition', () => {
    expect(flat(carveToHtml(':: t\n:  d\n:: \nx\n'))).toBe(
      '<dl> <dt>t</dt> <dd>d</dd> </dl> <p>:: x</p>',
    )
  })

  it('closes an open term when the marker is a description one', () => {
    expect(flat(carveToHtml(':: t\n:  \nx\n'))).toBe('<dl> <dt>t</dt> </dl> <p>: x</p>')
  })

  it('leaves a bare :: alone', () => {
    // No trailing space. All three engines already agreed on this line, so the
    // pattern requires at least one space rather than matching the marker alone.
    const html = flat(carveToHtml(':: t\n::\nx\n'))
    expect(html).toBe('<dl> <dt>t :: x</dt> </dl>')
  })

  it('does not disturb an ordinary term and definition', () => {
    expect(flat(carveToHtml(':: t\n:  d\n'))).toBe('<dl> <dt>t</dt> <dd>d</dd> </dl>')
  })

  it('does not disturb a term that continues onto the next line', () => {
    // The fold this rule interrupts is a real one: a plain line still folds into
    // the term with a soft break.
    expect(flat(carveToHtml(':: t\nmore\n:  d\n'))).toBe('<dl> <dt>t more</dt> <dd>d</dd> </dl>')
  })
})
