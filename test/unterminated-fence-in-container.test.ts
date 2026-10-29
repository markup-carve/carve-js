import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// An unterminated fence's payload is opaque: a `:::` line inside it is payload, so the
// div runs to the end (markup-carve/carve#4018, replacing carve#515).
const squash = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('an unterminated fence inside a ::: body', () => {
  it('swallows the closing ::: as payload', () => {
    expect(squash(carveToHtml('::: note\n```\nx\n:::\nafter\n'))).toBe(
      '<aside class="admonition note" aria-label="Note"> <pre><code>x ::: after </code></pre> </aside>',
    )
  })

  it('does not invent a div after a blockquote', () => {
    const html = squash(carveToHtml('::: note\n> a\n```\n:::\nafter\n'))

    expect(html).not.toContain('<div>')
    expect(html.endsWith('<pre><code>::: after </code></pre> </aside>')).toBe(true)
  })

  it('leaves a closed fence opaque, so ::: inside one is literal', () => {
    expect(squash(carveToHtml('::: note\n````\n:::\n````\nafter\n:::\n'))).toBe(
      '<aside class="admonition note" aria-label="Note"> <pre><code>::: </code></pre> <p>after</p> </aside>',
    )
  })

  it('still opens a code block when there is nothing to interrupt', () => {
    expect(squash(carveToHtml('```\nx\n'))).toBe('<pre><code>x </code></pre>')
    expect(squash(carveToHtml('> ```\n'))).toBe(
      '<blockquote> <pre><code></code></pre> </blockquote>',
    )
  })
})
