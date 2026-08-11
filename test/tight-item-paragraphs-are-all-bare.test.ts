/*
 * A TIGHT item's paragraphs all render without `<p>` (carve-js#749, spec
 * markup-carve/carve#809).
 *
 * PART 9 §17 L1 is explicit, at `resources/grammar.ebnf:2991-2994`:
 *
 *   Tightness is a property of the WHOLE ITEM, not of an individual block: a
 *   tight item's paragraphs ALL render WITHOUT `<p>` (<li>text</li>), every one
 *   of them, not only the first; a loose item's paragraphs are ALL wrapped.
 *
 * `renderListItem` carried an exception for a paragraph in the consecutive run
 * from index 0 - a `+`-attached second paragraph - on the belief that carve-php
 * did the same. Measured, it does not: carve-php and carve-rs both render it
 * bare, so the exception was this engine alone against the stated rule.
 *
 * It is also why corpus 228 failed here: the item is tight and the second
 * paragraph was the one being wrapped.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const list = (source: string): string =>
  (carveToHtml(source).split('</ul>')[0] + '</ul>').replace(/\n\s*/g, ' ')

describe('a tight item', () => {
  it('renders a plus-attached second paragraph bare', () => {
    expect(list('- a\n+\nb\n\nx\n')).toBe('<ul> <li>a b </li> </ul>')
  })

  it('renders a third paragraph bare too', () => {
    expect(list('- a\n+\nb\n+\nc\n\nx\n')).toBe('<ul> <li>a b c </li> </ul>')
  })

  it('renders a paragraph after a collected definition bare', () => {
    // Corpus 228. The definition renders nothing, so what remains is a tight
    // item holding two paragraphs.
    expect(list("- a\n+\n[^f]: x\n+\nmore\n\nsee[^f]\n")).toBe('<ul> <li>a more </li> </ul>')
  })

  it('still renders a paragraph after a closed block bare', () => {
    // The case the old exception deliberately left alone, unchanged.
    expect(list('- a\n+\n> q\n+\ntail\n\nx\n')).toContain('tail')
    expect(list('- a\n+\n> q\n+\ntail\n\nx\n')).not.toContain('<p>tail</p>')
  })
})

describe('a loose item', () => {
  it('wraps all of its paragraphs, as before', () => {
    expect(list('- a\n\n  b\n\nx\n')).toBe('<ul> <li><p>a</p> <p>b</p> </li> </ul>')
  })

  it('wraps a single paragraph too', () => {
    expect(list('- a\n\n- b\n')).toBe('<ul> <li><p>a</p></li> <li><p>b</p></li> </ul>')
  })
})
