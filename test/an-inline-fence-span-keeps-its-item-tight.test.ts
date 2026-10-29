import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

describe('an unclosed fence in an item runs to the end of its container', () => {
  it('keeps the blank and the next line in a child item fence', () => {
    expect(carveToHtml('- o\n  - h\n    ```\n\n    b\n  t\n')).toBe(
      '<ul>\n  <li>o\n    <ul>\n      <li>h\n        <pre><code>\nb\n</code></pre>\n      </li>\n    </ul>\n    t\n  </li>\n</ul>',
    )
  })

  it('keeps the blank in a quoted item fence', () => {
    expect(carveToHtml('> - a\n>   ```\n>   x\n>\n>   z\nflush\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n      <pre><code>x\n\nz\n</code></pre>\n    </li>\n  </ul>\n</blockquote>\n<p>flush</p>',
    )
  })

  for (const fence of ['```', '````', '~~~', '~~~~']) {
    it(`keeps the paragraph after the blank in the unterminated ${fence} fence`, () => {
      expect(carveToHtml(`- a\n  ${fence}\n  x\n\n  z\n`)).toBe(
        '<ul>\n  <li>a\n    <pre><code>x\n\nz\n</code></pre>\n  </li>\n</ul>',
      )
    })

    it(`counts a paragraph separator after a closed ${fence} block`, () => {
      const html = carveToHtml(`- a\n  ${fence}\n  x\n  ${fence}\n\n  z\n`)
      expect(html).toContain('<p>a</p>')
      expect(html).toContain('<p>z</p>')
    })
  }

  it('keeps each later paragraph in the unterminated fence', () => {
    expect(carveToHtml('- a\n  ```\n  x\n\n  z\n\n  w\n')).toBe(
      '<ul>\n  <li>a\n    <pre><code>x\n\nz\n\nw\n</code></pre>\n  </li>\n</ul>',
    )
  })

  it('still loosens on a blank before the next sibling', () => {
    expect(carveToHtml('- a\n  ```\n  x\n\n- z\n')).toContain('<p>z</p>')
  })

  it('still loosens two ordinary paragraphs', () => {
    expect(carveToHtml('- a\n\n  z\n')).toContain('<p>z</p>')
  })

  it('bounds repeated unclosed fences', () => {
    const previous = layoutWork.on
    try {
      const work = [100, 400, 800].map(count => {
        const source = '- a\n  ```\n  x\n\n  z\n\n'.repeat(count)
        layoutWork.reset()
        layoutWork.on = true
        const html = renderHtml(parse(source))
        expect(html.match(/<pre><code>x\n\nz\n\n<\/code><\/pre>/g)?.length).toBe(count)
        return layoutWork.gate + layoutWork.strip + layoutWork.seam + layoutWork.offsets + layoutWork.closerLines
      })
      expect(work[1]!).toBeLessThanOrEqual(work[0]! * 4.5)
      expect(work[2]!).toBeLessThanOrEqual(work[1]! * 2.5)
    } finally {
      layoutWork.on = previous
      layoutWork.reset()
    }
  })
})
