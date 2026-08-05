/*
 * A definition written inside a definition list's `dd` is COLLECTED, and the
 * entry keeps no trace of it (carve-js#730, spec markup-carve/carve#801,
 * corpus 227).
 *
 * The `dd` rendered empty before this too - that is the visible half and it was
 * already right. What was missing is the collection: nothing registered the
 * definition, so the reference it feeds stayed literal somewhere ELSE in the
 * document. Silent where the definition was written, visible where it was used.
 *
 * The footnote prepass here already collected from a `dd`; the link-reference
 * prepass did not, because `stripContainerPrefixesKeepIndent` knew the
 * blockquote, list and task markers and not the description one. carve-php had
 * the mirror image and needed both (carve-php#892).
 *
 * THE MARKER IS NOT STRIPPED UNCONDITIONALLY. A `:` line with no term above it
 * is not a description at all - it is paragraph text, and a definition in it
 * defines nothing (corpus 216-a-description-line-needs-a-term-above-it). That is
 * what the `afterTerm` gate is for, and the tests below pin both directions.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.replace(/\n\s*/g, ' ').trim()

describe('a definition inside a definition list', () => {
  it('collects a link definition written in a description', () => {
    const html = flat(carveToHtml(':: term\n:  [r]: /u\n\nsee [t][r]\n'))
    expect(html).toContain('<a href="/u">t</a>')
    expect(html).toContain('<dd></dd>')
  })

  it('collects a footnote definition written in a description', () => {
    const html = flat(carveToHtml(':: term\n:  [^f]: x\n\nsee[^f]\n'))
    expect(html).toContain('role="doc-noteref"')
    expect(html).toContain('<dd></dd>')
  })

  it('refuses a link definition with no term above it', () => {
    // Corpus 216: without a term the line is not a description, so the line
    // stays visible and defines nothing.
    const html = flat(carveToHtml(':  [r]: /u\n\nsee [t][r]\n'))
    expect(html).toContain('<p>:  [r]: /u</p>')
    expect(html).not.toContain('<a href="/u">')
  })

  it('refuses a footnote definition with no term above it', () => {
    expect(flat(carveToHtml(':  [^f]: x\n\nsee[^f]\n'))).not.toContain('role="doc-noteref"')
  })

  it('collects from a second description in the same entry', () => {
    // An entry is continued by a further description, so a term is not the only
    // thing that can precede one.
    const html = flat(carveToHtml(':: term\n:  a\n:  [r]: /u\n\nsee [t][r]\n'))
    expect(html).toContain('<a href="/u">t</a>')
  })

  it('does not read a term marker as a description marker', () => {
    // `::` needs whitespace after a SINGLE colon to be a description, and does
    // not have it - so this is a term and the line is its content.
    expect(flat(carveToHtml(':: [r]: /u\n\nsee [t][r]\n'))).not.toContain('<a href="/u">t</a>')
  })

  it('does not read a colon fence as a description marker', () => {
    const html = flat(carveToHtml(':: term\n::: note\nbody\n:::\n\nx\n'))
    expect(html).not.toContain('<dd>::: note</dd>')
  })
})
