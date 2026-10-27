import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('does not register a definition in the second sibling item comment', () => {
  expect(carveToHtml('- %%%\n- %%%\n  [r]: /url\n  %%%\n\n[r][]\n')).toBe(
    '<ul>\n  <li></li>\n  <li></li>\n</ul>\n<p>[r][]</p>',
  )
})
