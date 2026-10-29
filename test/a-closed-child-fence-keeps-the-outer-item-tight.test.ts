import { describe, expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

describe('a closed child fence before an outer fence', () => {
  it.each([
    ['plain', '- outer\n  - head\n    ```\n    a\n    ```\n  ```\n\n  tail\n  ```\n- next\n'],
    ['quoted', '> - outer\n>   - head\n>     ```\n>     a\n>     ```\n>   ```\n>\n>   tail\n>   ```\n> - next\n'],
    ['ordered', '1. outer\n   1. head\n      ```\n      a\n      ```\n   ```\n\n   tail\n   ```\n2. next\n'],
  ])('%s keeps the outer item tight', (_name, source) => {
    const html = renderHtml(parse(source))
    expect(html).toContain('<li>outer')
    expect(html).not.toContain('<li><p>outer</p>')
    expect(html).toContain('<li>next</li>')
  })

  it('ends the child fence at a dedented run, which opens a document fence', () => {
    const source = '- outer\n  - head\n    ```\n    a\n```\n\n  tail\n'
    const html = renderHtml(parse(source))
    expect(html).toContain('<li>outer')
    expect(html).toContain('<pre><code>a\n</code></pre>')
    expect(html).toContain('</ul>\n<pre><code>\n  tail\n</code></pre>')
  })
})
