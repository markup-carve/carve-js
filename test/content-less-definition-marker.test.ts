/*
 * A CONTENT-LESS TERM marker line closes the open item and stays paragraph text
 * (carve-js#731).
 *
 * `::` with nothing after it but whitespace is not a marker - the term pattern
 * requires content - so the line is prose and a BOUNDARY: the
 * term-continuation loop and the definition-body loop each break on it.
 *
 * THE DESCRIPTION MARKER ANSWERS DIFFERENTLY, and that is the ruling rather
 * than an inconsistency: `:` plus whitespace is a plain line under the open
 * term, which folds it as a soft break and drops its trailing run
 * (markup-carve/carve#1830). It is pinned in
 * `a-colon-followed-by-only-whitespace-is-not-a-description.test.ts`; the row
 * below keeps it out of THIS rule's way.
 *
 * A bare `::`, with no trailing space, folds as well - which is why the pattern
 * requires at least one space and leaves that line alone.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.replace(/\s+/g, ' ').trim()

describe('a content-less term marker line', () => {
  it('closes an open term', () => {
    expect(flat(carveToHtml(':: t\n:: \nx\n'))).toBe('<dl> <dt>t</dt> </dl> <p>:: x</p>')
  })

  it('closes an open definition', () => {
    expect(flat(carveToHtml(':: t\n:  d\n:: \nx\n'))).toBe(
      '<dl> <dt>t</dt> <dd>d</dd> </dl> <p>:: x</p>',
    )
  })

  it('does not close on a content-less DESCRIPTION marker, which folds instead', () => {
    expect(flat(carveToHtml(':: t\n:  \nx\n'))).toBe('<dl> <dt>t : x</dt> </dl>')
  })

  /**
   * A TAB AFTER `::` IS NOT A SEPARATOR AT ALL, so the line is not a
   * content-less marker either - it folds, like the bare `::` below. A MARKER
   * SEPARATOR is spelled `space` and a tab never satisfies it (PART 1), which
   * is what carve-php reads and what this engine closed on.
   */
  it('folds when a tab follows the marker directly', () => {
    expect(flat(carveToHtml(':: t\n::\tx_no\n'))).toBe('<dl> <dt>t :: x_no</dt> </dl>')
    expect(flat(carveToHtml(':: t\n::\t\nx\n'))).toBe('<dl> <dt>t :: x</dt> </dl>')
  })

  /**
   * ONCE THE SEPARATOR IS THERE, any trailing whitespace makes the line
   * content-less and it closes - a tab after the space included.
   */
  it('closes on a space then a tab', () => {
    expect(flat(carveToHtml(':: t\n:: \t\nx\n'))).toBe('<dl> <dt>t</dt> </dl> <p>:: x</p>')
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
