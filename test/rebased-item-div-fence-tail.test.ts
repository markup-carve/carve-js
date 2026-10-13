import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each(['', '  text\n'])('releases a column-zero tail after a closed fence in an item div', before => {
  const source = `- a\n  ::: box\n${before}    \`\`\`\n    code\n    \`\`\`\nafter`
  const html = carveToHtml(source)
  expect(html).toMatch(/<div class="box">[\s\S]*<pre><code>code\n<\/code><\/pre>\s*<\/div>/)
  if (before) expect(html).toContain('<p>text</p>')
  expect(html).toMatch(/<\/ul>\s*<p>after<\/p>$/)
})
