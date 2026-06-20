import { describe, expect, it } from 'vitest'

import { carveToHtml, mathBlock } from '../src/index.js'

describe('math-block extension', () => {
  it('renders a math code block as <div class="math display">\\[…\\]</div>', () => {
    const src = '``` math\n\\int_0^1 x^2 \\, dx\n```'
    expect(carveToHtml(src, { extensions: [mathBlock()] })).toBe(
      '<div class="math display">\\[\\int_0^1 x^2 \\, dx\\]</div>',
    )
  })

  it('escapes &, <, and > like the core math renderer', () => {
    const src = '``` math\na < b & c > d\n```'
    expect(carveToHtml(src, { extensions: [mathBlock()] })).toBe(
      '<div class="math display">\\[a &lt; b &amp; c &gt; d\\]</div>',
    )
  })

  it('defers a non-math code block to the core renderer', () => {
    const src = '``` js\nconst x = 1\n```'
    expect(carveToHtml(src, { extensions: [mathBlock()] })).toBe(
      '<pre><code class="language-js">const x = 1\n</code></pre>',
    )
  })

  it('is inert without the extension (math stays a plain code block)', () => {
    const src = '``` math\nx^2\n```'
    expect(carveToHtml(src)).toBe('<pre><code class="language-math">x^2\n</code></pre>')
  })
})
