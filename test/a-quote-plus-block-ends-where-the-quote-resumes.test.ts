import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A separate-line `+` after a quoted line attaches the next block to the quote.
// That block ends at the line after it: an open fence ends there, and nothing
// the source does not hold is added to it.
const html = (src: string): string => carveToHtml(src).replace(/>\s+</g, '><').trim()

describe('a quote plus block ends where the quote resumes', () => {
  it.each([
    ['backtick paragraph', '> a\n+\n: ``` js\n> q\n',
      '<blockquote><p>a</p><p>: <code> js</code></p><p>q</p></blockquote>'],
    ['tilde paragraph', '> a\n+\n: ~~~ js\n> q\n',
      '<blockquote><p>a</p><p>: ~~~ js</p><p>q</p></blockquote>'],
    ['description fence', '> :: t\n+\n: ``` js\n> q\n',
      '<blockquote><dl><dt>t</dt><dd><pre><code class="language-js"></code></pre></dd></dl><p>q</p></blockquote>'],
    ['description fence at the end', '> :: t\n+\n: ``` js\n',
      '<blockquote><dl><dt>t</dt><dd><pre><code class="language-js"></code></pre></dd></dl></blockquote>'],
    ['item fence', '> a\n+\n- ``` js\n  x\n> q\n',
      '<blockquote><p>a</p><ul><li><pre><code class="language-js">x\n</code></pre></li></ul><p>q</p></blockquote>'],
    ['item fence at the end', '> a\n+\n- ``` js\n  x\n',
      '<blockquote><p>a</p><ul><li><pre><code class="language-js">x\n</code></pre></li></ul></blockquote>'],
    ['first-block item fence', '> +\n- ``` js\n  x\n> q\n',
      '<blockquote><ul><li><pre><code class="language-js">x\n</code></pre></li></ul><p>q</p></blockquote>'],
    ['first-block item fence at the end', '> +\n- ``` js\n  x',
      '<blockquote><ul><li><pre><code class="language-js">x</code></pre></li></ul></blockquote>'],
    ['item fence before a refused plus', '> a\n+\n- ``` js\n  x\n+\n\nq\n',
      '<blockquote><p>a</p><ul><li><pre><code class="language-js">x\n</code></pre></li></ul></blockquote><p>+</p><p>q</p>'],
    ['flush-left fence', '> a\n+\n``` js\nx\n```\n> q\n',
      '<blockquote><p>a</p><pre><code class="language-js">x\n</code></pre><p>q</p></blockquote>'],
  ])('%s', (_name, src, expected) => {
    expect(html(src)).toBe(expected)
  })
})
