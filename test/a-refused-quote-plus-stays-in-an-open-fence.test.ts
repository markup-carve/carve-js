import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `+` with nothing to attach after a fence a quote's `+` attached and left
// open is that fence's payload; it never disappears.
const html = (src: string): string => carveToHtml(src).replace(/>\s+</g, '><').trim()

describe('a refused quote plus stays in an open fence', () => {
  it.each([
    ['refused plus after an open fence', '> a\n+\n``` js\nx\n+\n',
      '<blockquote><p>a</p><pre><code class="language-js">x\n+\n</code></pre></blockquote>'],
    ['tilde fence', '> a\n+\n~~~\nx\n+\n',
      '<blockquote><p>a</p><pre><code>x\n+\n</code></pre></blockquote>'],
    ['refused plus before a blank and a paragraph', '> a\n+\n``` js\nx\n+\n\ny\n',
      '<blockquote><p>a</p><pre><code class="language-js">x\n+\n</code></pre></blockquote><p>y</p>'],
    ['first-block plus quote', '> +\n``` js\nx\n+\n',
      '<blockquote><pre><code class="language-js">x\n+\n</code></pre></blockquote>'],
    ['list-hosted quote', '- > a\n  +\n  ``` js\n  x\n  +\n',
      '<ul><li><blockquote><p>a</p><pre><code class="language-js">x\n+\n</code></pre></blockquote></li></ul>'],
    ['closed fence leaves the plus to a paragraph', '> a\n+\n``` js\nx\n```\n+\n',
      '<blockquote><p>a</p><pre><code class="language-js">x\n</code></pre></blockquote><p>+</p>'],
    ['an indented closer run is payload', '> a\n+\n```\nx\n    ```\n+\n',
      '<blockquote><p>a</p><pre><code>x\n    ```\n+\n</code></pre></blockquote>'],
    ['a plus that attaches still attaches', '> a\n+\n``` js\nx\n+\ny\n',
      '<blockquote><p>a</p><pre><code class="language-js">x\n</code></pre><p>y</p></blockquote>'],
  ])('%s', (_name, src, expected) => {
    expect(html(src)).toBe(expected)
  })
})
