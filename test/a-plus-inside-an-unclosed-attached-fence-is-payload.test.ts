import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §17 L3: "A `+` at the fence's content column stays payload", with or
// without a later blank (carve#5494 option 1, carve#5484).
const item = (code: string, after = '') =>
  `<ul>\n  <li>\n    <pre><code>${code}</code></pre>\n  </li>\n</ul>${after}`

describe('a + inside an unclosed fence a + attached', () => {
  it('is the code, not a refused marker stand-in', () => {
    expect(carveToHtml('- +\n```\n+\n').trim()).toBe(item('+\n'))
  })

  it('is the code when a blank and a paragraph follow', () => {
    expect(carveToHtml('- +\n```\n+\n\ny\n').trim()).toBe(item('+\n', '\n<p>y</p>'))
  })

  it('is the code after other payload and as a run', () => {
    expect(carveToHtml('- +\n```\nx\n+\n').trim()).toBe(item('x\n+\n'))
    expect(carveToHtml('- +\n~~~\n+\n+\n').trim()).toBe(item('+\n+\n'))
  })

  it('is the code under a quote host', () => {
    expect(carveToHtml('> +\n```\n+\n').trim()).toBe('<blockquote>\n  <pre><code>+\n</code></pre>\n</blockquote>')
  })

  it('is the code in a nested item at the fence column', () => {
    expect(carveToHtml('- a\n  - +\n  ```\n  +\n').trim()).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <pre><code>+\n</code></pre>\n      </li>\n    </ul>\n  </li>\n</ul>')
  })

  it('is the code in a footnote body followed by a blank', () => {
    expect(carveToHtml('r[^1]\n\n[^1]: +\n```\n+\n\ny\n')).toContain('<pre><code>+\n</code></pre>')
  })

  it('leaves a later + after a blank to its own paragraph under a quoted item', () => {
    expect(carveToHtml('> - +\n> ```\n> +\n> z\n> ```\n\n+\n')).toContain('</blockquote>\n<p>+</p>')
    expect(carveToHtml('> - +\n> x\n\n+\n')).toContain('</blockquote>\n<p>+</p>')
  })

  it('still ends the fence when it stands left of the fence column', () => {
    expect(carveToHtml('- +\n  ```\n+\n').trim()).toBe(item(''))
  })
})
