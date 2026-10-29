// carve#4018: a ``` or ~~~ opener interrupts a paragraph whether or not it closes,
// and an unclosed fence runs to the end of its container.
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const squash = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('an unterminated fence after a list item', () => {
  it('ends the item and opens an unclosed code block', () => {
    expect(squash(carveToHtml('* a\n```\n'))).toBe('<ul> <li>a</li> </ul> <pre><code></code></pre>')
  })

  it('does the same for a tilde fence', () => {
    expect(squash(carveToHtml('* a\n~~~\n'))).toBe('<ul> <li>a</li> </ul> <pre><code></code></pre>')
  })

  it('still breaks out when the fence IS closed', () => {
    const html = squash(carveToHtml('* a\n```\nx\n```\n'))
    expect(html).toContain('<pre><code>x')
    expect(html).toContain('</ul>')
  })

  it('interrupts a top-level paragraph the same way', () => {
    expect(squash(carveToHtml('a\n```\n'))).toBe('<p>a</p> <pre><code></code></pre>')
  })

  it('still lets a `:::` opener end the list', () => {
    const html = squash(carveToHtml('* a\n:::\n'))
    expect(html).toContain('</ul>')
    expect(html).toContain('<div>')
  })
})
