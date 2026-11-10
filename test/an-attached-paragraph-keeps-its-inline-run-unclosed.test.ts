import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a first-block plus attaching a paragraph with a fence-shaped line', () => {
  it.each([
    ['description', ':: t\n: +\n{.x\n.y}\n```\nwa\n', '<dd>{.x\n.y}</dd>\n</dl>\n<pre><code>wa\n</code></pre>'],
    ['footnote', '[^a]: +\n{.x\n.y}\n```\nwa\n\nsee[^a]\n', '<pre><code>wa\n\nsee[^a]\n</code></pre>'],
  ])('ends a refused run paragraph in a %s at the fence, which opens a code block (carve#5830)', (_host, source, expected) => {
    expect(carveToHtml(source)).toContain(expected)
  })

  it('still closes a directly attached fence at its first blank', () => {
    const html = carveToHtml(':: t\n: +\n```x\ncode\n\nafter\n')
    expect(html).toContain('<pre><code class="language-x">code\n</code></pre>')
    expect(html).toContain('<p>after</p>')
  })
})
