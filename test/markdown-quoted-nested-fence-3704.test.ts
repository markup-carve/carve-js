import { expect, it } from 'vitest'
import { parseFragment, serialize } from 'parse5'
import { carveToHtml, markdownToCarve } from '../src/index.js'

const normalized = (html: string) => serialize(parseFragment(html.replace(/>\s+</g, '><').trim()))

it.each([
  ['- > - ```\n  >   ```', '<pre><code></code></pre>'],
  ['- > - ```\n  >   x\n  >   ```', '<pre><code>x\n</code></pre>'],
  ['- > 10. ```\n  >     ```', '<pre><code></code></pre>'],
])('keeps a closed fence in a quoted nested item: %s', (source, code) => {
  const imported = markdownToCarve(source)
  expect(imported).toBe(source)
  const rendered = normalized(carveToHtml(imported))
  expect(rendered).toContain(code)
  expect(rendered).not.toContain('<li>```</li>')
})
