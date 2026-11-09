import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#4758: a marker in an item body opens there, so it ends the stanza it missed instead of folding into it.
describe('a list marker that misses a nested item stanza', () => {
  it('opens a sibling in the nested list', () => {
    expect(carveToHtml('- x\n  - ::: |\n    a\n   - y\n')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>\n        <div class="line-block">\n          <p>a</p>\n        </div>\n      </li>\n' +
      '      <li>y</li>\n    </ul>\n  </li>\n</ul>')
  })

  it('holds for other payloads and markers', () => {
    for (const payload of ['a', '```', '~~~', ':::'])
      for (const marker of ['- y', '1. y']) {
        const html = carveToHtml(`- x\n  - ::: |\n    ${payload}\n   ${marker}\n`)
        expect(html, `${payload} / ${marker}`).toContain('      <li>y</li>\n    </')
        expect(html, `${payload} / ${marker}`).not.toContain('\n  <li>y</li>')
      }
  })

  it('still folds a missed text line into the stanza', () => {
    expect(carveToHtml('::: |\n  a\n - y\n')).toBe('<div class="line-block">\n  <p>&nbsp;&nbsp;a<br>\n&nbsp;- y</p>\n</div>')
  })
})
