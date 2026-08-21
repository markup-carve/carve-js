import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * An unterminated code fence is not an opaque span.
 *
 * A fence opener with no closer ahead does not open a code block that swallows
 * the structure around it. Inside a `:::` body that matters twice: the
 * container's own closing `:::` stays structural, and text written after it is
 * not dragged inside.
 *
 * Decided in markup-carve/carve#515, where the engines had split 2-1 - carve-js
 * and carve-rs let the fence win and consume the rest of the document,
 * carve-php let the div closer win. carve-php's rule was adopted: it is what
 * PART 9 §10 I4 already says one level up (an opener with no closer is not a
 * fence), and it bounds the blast radius of one unclosed fence.
 */
const squash = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('an unterminated fence inside a ::: body', () => {
  it('does not swallow the closing :::', () => {
    expect(squash(carveToHtml('::: note\n```\nx\n:::\nafter\n'))).toBe(
      '<aside class="admonition note" aria-label="Note"> <pre><code>x </code></pre> </aside> <p>after</p>',
    )
  })

  it('does not invent a div after a blockquote', () => {
    const html = squash(carveToHtml('::: note\n> a\n```\n:::\nafter\n'))

    expect(html).not.toContain('<div>')
    expect(html.endsWith('</aside> <p>after</p>')).toBe(true)
  })

  it('leaves a closed fence opaque, so ::: inside one is literal', () => {
    expect(squash(carveToHtml('::: note\n````\n:::\n````\nafter\n:::\n'))).toBe(
      '<aside class="admonition note" aria-label="Note"> <pre><code>::: </code></pre> <p>after</p> </aside>',
    )
  })

  it('still opens a code block when there is nothing to interrupt', () => {
    // I4 gates INTERRUPTION. Unchanged, and the same in all three engines.
    expect(squash(carveToHtml('```\nx\n'))).toBe('<pre><code>x </code></pre>')
    expect(squash(carveToHtml('> ```\n'))).toBe(
      '<blockquote> <pre><code> </code></pre> </blockquote>',
    )
  })
})
