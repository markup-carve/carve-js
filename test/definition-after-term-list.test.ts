import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('collects a definition in a list after a preceding term', () => {
  expect(carveToHtml(':: t\n  - para\n    [r]: /u\n\n[r][]\n')).toBe(
    '<dl>\n  <dt>t</dt>\n</dl>\n<ul>\n  <li>para</li>\n</ul>\n<p><a href="/u">r</a></p>',
  )
})
