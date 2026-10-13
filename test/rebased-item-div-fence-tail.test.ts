import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each(['', '  text\n'])('releases a column-zero tail after a closed fence in an item div', before => {
  const source = `- a\n  ::: box\n${before}    \`\`\`\n    code\n    \`\`\`\nafter`
  const html = carveToHtml(source)
  expect(html).toMatch(/<div class="box">[\s\S]*<pre><code>code\n<\/code><\/pre>\s*<\/div>/)
  if (before) expect(html).toContain('<p>text</p>')
  expect(html).toMatch(/<\/ul>\s*<p>after<\/p>$/)
})

it.each([
  ['a closed line block', '    ::: |\n    x\n    :::', '<div class="line-block">'],
  ['an unclosed code fence', '    ```\n    code', '<pre><code>code\n</code></pre>'],
])('releases a column-zero tail after %s in an item div', (_name, body, rendered) => {
  const html = carveToHtml(`- a\n  ::: box\n${body}\nafter`)
  expect(html).toContain(rendered)
  expect(html).toMatch(/<\/ul>\s*<p>after<\/p>$/)
})
