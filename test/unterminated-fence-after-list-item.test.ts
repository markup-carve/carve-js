/*
 * PART 9 §10's I4 guards the verbatim fence unconditionally: an unterminated
 * ``` or ~~~ opener does not interrupt, the line stays paragraph text, and the
 * stray fence opens an unclosed inline verbatim run.
 *
 * This engine applied that at the top level and not after a list item, where
 * `lazyContinuationEndsList` tested the fence shape with no closer lookahead
 * (carve-js#540). carve-rs is the engine that had it right.
 *
 * The `:::` arm of that function stays deliberately unguarded - I4 does not
 * cover it (markup-carve/carve#514 corrected the clause), and the comment there
 * gives the separate reason.
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const squash = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('an unterminated fence after a list item', () => {
  it('stays inside the item as an inline verbatim run', () => {
    expect(squash(carveToHtml('* a\n```\n'))).toBe('<ul> <li>a <code></code></li> </ul>')
  })

  it('does the same for a tilde fence, which has no inline form', () => {
    // The fence stays paragraph text either way. `~~~` then renders literally
    // rather than as a verbatim run, because only backticks open an inline
    // code span - matching carve-rs byte for byte.
    expect(squash(carveToHtml('* a\n~~~\n'))).toBe('<ul> <li>a ~~~</li> </ul>')
  })

  it('still breaks out when the fence IS closed', () => {
    // The guard is about the closer, not about list items.
    const html = squash(carveToHtml('* a\n```\nx\n```\n'))
    expect(html).toContain('<pre><code>x')
    expect(html).toContain('</ul>')
  })

  it('leaves the top-level case alone', () => {
    // Corpus 81-paragraph-interruption-18, unchanged.
    expect(squash(carveToHtml('a\n```\n'))).toBe('<p>a <code></code></p>')
  })

  it('still lets a `:::` opener end the list', () => {
    // I4 does not guard `:::`, and this function's `:::` arm has its own
    // reason for staying lexer-free. A colon fence still ends the item.
    const html = squash(carveToHtml('* a\n:::\n'))
    expect(html).toContain('</ul>')
    expect(html).toContain('<div>')
  })
})
