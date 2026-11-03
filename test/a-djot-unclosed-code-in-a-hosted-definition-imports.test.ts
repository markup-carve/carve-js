import { expect, it } from 'vitest'
import { carveToHtml, migrateDjot } from '../src/index.js'

// Joining a tight description's paragraphs must not throw where the joined text cannot be spelled.
it.each([
  '- : `A\n\n    B`\n\n    desc',
  '- : `A\n\n    B`\n\n    `d\n    e`',
  '> - : `A\n>\n>     B`\n>\n>     desc',
  '1. : `A\n\n     B`\n\n     desc',
  '::: box\n- : `A\n\n    B`\n\n    desc\n:::',
])('imports an unclosed code span in a hosted description: %j', source => {
  const html = carveToHtml(migrateDjot(source).value)
  expect(html).toMatch(/<dt><code>A<\/code><\/dt>/)
  expect(html).toMatch(/<dd>\s*<p>B<code><\/code><\/p>/)
})
