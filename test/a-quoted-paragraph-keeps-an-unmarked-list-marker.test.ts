import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// An unmarked marker at the item content column closes the quote and opens the item's list (PART 0 S3, carve#4860).
it('opens the item list at an unmarked list marker below an open quoted paragraph', () => {
  const html = carveToHtml('- a\n\t> q\n  - b')
  expect(html).toContain('<blockquote><p>q</p></blockquote>')
  expect(html).toContain('<li>b</li>')
})
