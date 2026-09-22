/*
 * A CONTENT-LESS TERM marker line is text, and it folds into the open term or
 * definition body (#1891).
 *
 * `::` with nothing after it but whitespace is not a marker, since the term
 * pattern requires content, and PART 2's empty-marker rule makes `::` and `:: `
 * one line. Below a body's column only a block opener ends it (CARVE-P2-017),
 * and this opens none. carve-js#731 read the line as a boundary instead, to
 * match carve-php and carve-rs; the spec's ruling on #1891 reversed that.
 *
 * The description marker `:` plus whitespace folds the same way
 * (markup-carve/carve#1830), pinned in
 * `a-colon-followed-by-only-whitespace-is-not-a-description.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.replace(/\s+/g, ' ').trim()

describe('a content-less term marker line', () => {
  it('folds into an open term', () => {
    expect(flat(carveToHtml(':: t\n:: \nx\n'))).toBe('<dl> <dt>t :: x</dt> </dl>')
  })

  it('folds into an open definition', () => {
    expect(flat(carveToHtml(':: t\n:  d\n:: \nx\n'))).toBe('<dl> <dt>t</dt> <dd>d :: x</dd> </dl>')
  })

  it('folds a content-less DESCRIPTION marker too', () => {
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

  // Any trailing run folds the same way, a tab after the space included.
  it('folds on a space then a tab', () => {
    expect(flat(carveToHtml(':: t\n:: \t\nx\n'))).toBe('<dl> <dt>t :: x</dt> </dl>')
  })

  it('folds a bare :: the same way', () => {
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
