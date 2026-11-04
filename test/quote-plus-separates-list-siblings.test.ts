import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

// carve-js#4365, corpus 947: a quote's consumed continuation marker
// separates the siblings of the list it holds, including after an open fence.
describe('quote continuation between list siblings', () => {
  it('keeps the item fence payload and loosens the list', () => {
    const source = '> a\n+\n- ``` js\n  x\n+\n- y\n'
    expect(carveToHtml(source)).toBe(
      '<blockquote>\n  <p>a</p>\n  <ul>\n    <li>\n' +
      '      <pre><code class="language-js">x\n</code></pre>\n' +
      '    </li>\n    <li><p>y</p></li>\n  </ul>\n</blockquote>',
    )
    const quote = parse(source).children[0]!
    expect(quote.type).toBe('block_quote')
    if (quote.type === 'block_quote') {
      const list = quote.children.find((child) => child.type === 'list')
      expect(list?.tight).toBe(false)
    }
  })

  it('separates plain items in the same quote', () => {
    expect(carveToHtml('> a\n+\n- x\n+\n- y\n')).toContain('<li><p>y</p></li>')
  })

  it('keeps a list outside a quote tight', () => {
    expect(carveToHtml('- x\n+\n- y\n')).toBe('<ul>\n  <li>x</li>\n  <li>y</li>\n</ul>')
  })
})
