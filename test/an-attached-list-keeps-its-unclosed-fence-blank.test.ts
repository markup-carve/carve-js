import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a note plus attaching a list with an unclosed item fence', () => {
  it.each([
    ['root', '[^a]: +\n- li\n  ```x\n  code\n\nsee[^a]\n', 'code'],
    ['item host', '- [^a]: +\n  - li\n    ```x\n    [^z]: code\n\nsee[^a]\n', '[^z]: code'],
    ['plus payload', '[^a]: +\n- li\n  ```x\n  code\n\n  +\n\nsee[^a]\n', 'code\n\n+'],
  ])('keeps one payload blank in the %s', (_host, source, payload) => {
    const html = carveToHtml(source)
    expect(html).toContain(`<pre><code class="language-x">${payload}\n\n</code></pre>`)
    expect(html.match(/<pre>/g)).toHaveLength(1)
  })

  it('does not open a code fence inside a comment span', () => {
    const source = '[^a]: +\n- li\n  %%%\n  ```x\n  %%%\n\n  # heading\n\nsee[^a]\n'
    const html = carveToHtml(source)
    expect(html).toContain('</ul>\n      <h1 id="heading">heading</h1>')
    expect(html).not.toContain('<pre>')
  })
})
