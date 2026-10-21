import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { parse, renderHtml } from '../src/index.js'
import { layoutWork } from '../src/parse.js'

describe('an unclosed inline fence span ends at its paragraph blank', () => {
  it('separates the child item paragraph after an empty span', () => {
    expect(carveToHtml('- o\n  - h\n    ```\n\n    b\n  t\n')).toBe(
      '<ul>\n  <li>o\n    <ul>\n      <li><p>h\n<code></code></p>\n        <p>b\nt</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('separates the quoted item after the span', () => {
    expect(carveToHtml('> - a\n>   ```\n>   x\n>\n>   z\nflush\n')).toBe(
      '<blockquote>\n  <ul>\n    <li><p>a\n<code>\nx</code></p>\n      <p>z\nflush</p>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  for (const fence of ['```', '````', '~~~', '~~~~']) {
    it(`separates the paragraph after the unterminated ${fence} span`, () => {
      const lead = fence.startsWith('`') ? '<code>\nx</code>' : `${fence}\nx`
      expect(carveToHtml(`- a\n  ${fence}\n  x\n\n  z\n`)).toBe(
        `<ul>\n  <li><p>a\n${lead}</p>\n    <p>z</p>\n  </li>\n</ul>`,
      )
    })

    it(`counts a paragraph separator after a closed ${fence} block`, () => {
      const html = carveToHtml(`- a\n  ${fence}\n  x\n  ${fence}\n\n  z\n`)
      expect(html).toContain('<p>a</p>')
      expect(html).toContain('<p>z</p>')
    })
  }

  it('separates each later paragraph after the unterminated fence', () => {
    expect(carveToHtml('- a\n  ```\n  x\n\n  z\n\n  w\n')).toBe(
      '<ul>\n  <li><p>a\n<code>\nx</code></p>\n    <p>z</p>\n    <p>w</p>\n  </li>\n</ul>',
    )
  })

  it('still loosens on a blank before the next sibling', () => {
    expect(carveToHtml('- a\n  ```\n  x\n\n- z\n')).toContain('<p>z</p>')
  })

  it('still loosens two ordinary paragraphs', () => {
    expect(carveToHtml('- a\n\n  z\n')).toContain('<p>z</p>')
  })

  it('bounds repeated inline-span paragraph breaks', () => {
    const previous = layoutWork.on
    try {
      const work = [100, 400, 800].map(count => {
        const source = '- a\n  ```\n  x\n\n  z\n\n'.repeat(count)
        layoutWork.reset()
        layoutWork.on = true
        const html = renderHtml(parse(source))
        expect(html.match(/<p>z<\/p>/g)?.length).toBe(count)
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
