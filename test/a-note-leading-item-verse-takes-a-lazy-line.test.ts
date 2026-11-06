import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds a lazy line into the stanza in a note leading item (carve-js#4547)', () => {
  const html = carveToHtml('- [^n]: - ::: |\n          # H\nx\n\nr[^n]\n')
  expect(html).toContain('<ul>\n  <li></li>\n</ul>')
  expect(html).toContain('<p># H<br>\nx</p>')
})
