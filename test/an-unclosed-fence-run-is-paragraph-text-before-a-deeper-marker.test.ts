import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases = [
  {
    "name": "bullet item",
    "source": "- a\n  w2\n   ```\n    - w3\n",
    "html": "<ul><li>a\nw2\n    <pre><code> - w3\n</code></pre></li></ul>"
  },
  {
    "name": "ordered item",
    "source": "1. a\n   w2\n    ```\n     1. w3\n",
    "html": "<ol><li>a\nw2\n    <pre><code> 1. w3\n</code></pre></li></ol>"
  },
  {
    "name": "tilde run",
    "source": "- a\n  w2\n   ~~~\n    - w3\n",
    "html": "<ul><li>a\nw2\n    <pre><code> - w3\n</code></pre></li></ul>"
  },
  {
    "name": "quoted item",
    "source": "> - a\n>   w2\n>    ```\n>     - w3\n",
    "html": "<blockquote><ul><li>a\nw2\n      <pre><code> - w3\n</code></pre></li></ul></blockquote>"
  },
  {
    "name": "same-column marker",
    "source": "- a\n   ```\n   - w3\n",
    "html": "<ul><li>a\n    <pre><code>- w3\n</code></pre></li></ul>"
  },
  {
    "name": "plain text",
    "source": "- a\n  w2\n   x\n    - w3\n",
    "html": "<ul><li>a\nw2\nx\n    <ul><li>w3</li></ul></li></ul>"
  },
  {
    "name": "single backtick",
    "source": "- a\n  w2\n   `x\n    - w3\n",
    "html": "<ul><li>a\nw2\n<code>x</code><ul><li>w3</li></ul></li></ul>"
  },
  {
    "name": "quote successor",
    "source": "- a\n  w2\n   ```\n    > w3\n",
    "html": "<ul><li>a\nw2\n    <pre><code> &gt; w3\n</code></pre></li></ul>"
  },
  {
    "name": "heading successor",
    "source": "- a\n  w2\n   ```\n    # w3\n",
    "html": "<ul><li>a\nw2\n    <pre><code> # w3\n</code></pre></li></ul>"
  },
  {
    "name": "content-column marker",
    "source": "- a\n  w2\n   ```\n  - w3\n",
    "html": "<ul><li>a\nw2\n    <pre><code>- w3\n</code></pre></li></ul>"
  },
  {
    "name": "definition description ends at the fence opener (review-47)",
    "source": "  - :: term\n    : payload\n      ```\n     :  p2\n       ~~~\n      - sub\n",
    "html": "<ul><li><dl><dt>term</dt><dd><p>payload</p><pre><code></code></pre></dd><dd>p2</dd></dl><pre><code>- sub\n</code></pre></li></ul>"
  }
]

for (const { name, source, html } of cases) {
  it(name, () => {
    expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
  })
}
