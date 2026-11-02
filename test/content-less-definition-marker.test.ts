/*
 * A CONTENT-LESS TERM marker line is text (#1891): after a term it starts a
 * paragraph (carve#4861), and it folds into an open definition body.
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
  it('starts a paragraph after a term', () => {
    expect(flat(carveToHtml(':: t\n:: \nx\n'))).toBe('<dl> <dt>t</dt> </dl> <p>:: x</p>')
  })

  it('folds into an open definition', () => {
    expect(flat(carveToHtml(':: t\n:  d\n:: \nx\n'))).toBe('<dl> <dt>t</dt> <dd>d :: x</dd> </dl>')
  })

  it('reads a content-less DESCRIPTION marker the same way', () => {
    expect(flat(carveToHtml(':: t\n:  \nx\n'))).toBe('<dl> <dt>t</dt> </dl> <p>: x</p>')
  })

  /**
   * A TAB AFTER `::` IS NOT A SEPARATOR AT ALL, so the line is not a
   * content-less marker either - it is text, like the bare `::` below. A MARKER
   * SEPARATOR is spelled `space` and a tab never satisfies it (PART 1), which
   * is what carve-php reads and what this engine closed on.
   */
  it('is text when a tab follows the marker directly', () => {
    expect(flat(carveToHtml(':: t\n::\tx_no\n'))).toBe('<dl> <dt>t</dt> </dl> <p>:: x_no</p>')
    expect(flat(carveToHtml(':: t\n::\t\nx\n'))).toBe('<dl> <dt>t</dt> </dl> <p>:: x</p>')
  })

  // Any trailing run reads the same way, a tab after the space included.
  it('is text on a space then a tab', () => {
    expect(flat(carveToHtml(':: t\n:: \t\nx\n'))).toBe('<dl> <dt>t</dt> </dl> <p>:: x</p>')
  })

  it('reads a bare :: the same way', () => {
    const html = flat(carveToHtml(':: t\n::\nx\n'))
    expect(html).toBe('<dl> <dt>t</dt> </dl> <p>:: x</p>')
  })

  it('does not disturb an ordinary term and definition', () => {
    expect(flat(carveToHtml(':: t\n:  d\n'))).toBe('<dl> <dt>t</dt> <dd>d</dd> </dl>')
  })

  it('reads the line after a term as a paragraph', () => {
    // A term is one line (carve#4861), so `: d` is that paragraph's text.
    expect(flat(carveToHtml(':: t\nmore\n:  d\n'))).toBe('<dl> <dt>t</dt> </dl> <p>more : d</p>')
  })
})
