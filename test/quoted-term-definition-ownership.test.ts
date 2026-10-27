import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('does not use a quoted term to open a document-level description', () => {
  expect(carveToHtml('> :: t\n: a\n  [r]: /u\n\n[r][]\n')).toBe(
    '<blockquote>\n  <dl>\n    <dt>t</dt>\n  </dl>\n</blockquote>\n<p>: a\n[r]: /u</p>\n<p>[r][]</p>',
  )
})
