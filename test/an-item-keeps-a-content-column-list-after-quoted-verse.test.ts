import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a content-column list in its item after an unclosed quoted line block', () => {
  expect(carveToHtml('- > ::: |\n  > a\n  - y\n')).toBe('<ul>\n  <li>\n    <blockquote>\n      <div class="line-block">\n        <p>a</p>\n      </div>\n    </blockquote>\n    <ul>\n      <li>y</li>\n    </ul>\n  </li>\n</ul>')
})
