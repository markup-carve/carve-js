import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('an inline fence span keeps its item tight', () => {
  it('keeps the quoted item in issue 2358 tight', () => {
    expect(carveToHtml('> - a\n>   ```\n>   x\n>\n>   z\nflush\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n<code>\nx</code>\n      z\nflush\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  for (const fence of ['```', '````', '~~~', '~~~~']) {
    it(`ignores a blank inside the unterminated ${fence} span`, () => {
      const lead = fence.startsWith('`') ? '<code>\nx</code>' : `${fence}\nx`
      expect(carveToHtml(`- a\n  ${fence}\n  x\n\n  z\n`)).toBe(
        `<ul>\n  <li>a\n${lead}\n    z\n  </li>\n</ul>`,
      )
    })

    it(`counts a paragraph separator after a closed ${fence} block`, () => {
      const html = carveToHtml(`- a\n  ${fence}\n  x\n  ${fence}\n\n  z\n`)
      expect(html).toContain('<p>a</p>')
      expect(html).toContain('<p>z</p>')
    })
  }

  it('keeps later blanks after the unterminated fence from loosening', () => {
    expect(carveToHtml('- a\n  ```\n  x\n\n  z\n\n  w\n')).toBe(
      '<ul>\n  <li>a\n<code>\nx</code>\n    z\n    w\n  </li>\n</ul>',
    )
  })

  it('still loosens on a blank before the next sibling', () => {
    expect(carveToHtml('- a\n  ```\n  x\n\n- z\n')).toContain('<p>z</p>')
  })

  it('still loosens two ordinary paragraphs', () => {
    expect(carveToHtml('- a\n\n  z\n')).toContain('<p>z</p>')
  })
})
