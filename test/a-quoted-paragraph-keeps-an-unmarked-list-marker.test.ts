import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('folds an unmarked list marker at an item content column into an open quoted paragraph', () => {
  const html = carveToHtml('- a\n\t> q\n  - b')
  expect(html).toContain('<blockquote><p>q\n- b</p></blockquote>')
  expect(html).not.toContain('<li>b</li>')
})
