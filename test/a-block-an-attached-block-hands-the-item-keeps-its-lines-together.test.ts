import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\s*\n\s*/g, '')

// §17 L3: a refused `+` stays text; an opener at the item's content column after it is the item's block, body and closer included.
describe('a block an attached block hands the item keeps its lines together', () => {
  it.each([
    ['- q\n+\n+\n  ```\n  c\n  ```\n', '<ul><li>q+<pre><code>c</code></pre></li></ul>'],
    ['- q\n+\n+\n    ```\n    c\n    ```\n', '<ul><li>q+<pre><code>c</code></pre></li></ul>'],
    ['1. q\n+\n+\n   ```\n   c\n   ```\n', '<ol><li>q+<pre><code>c</code></pre></li></ol>'],
  ])('%j', (source, expected) => expect(html(source)).toBe(expected))
})
