import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A quote's first-block `+` that attaches nothing stays its text (never-drop).
const tight = (html: string): string => html.replace(/>\s+</g, '><').trim()

it.each([
  ['> a\n+\n```\n\n> +\n\n\n',
    '<blockquote><p>a</p><pre><code></code></pre></blockquote><blockquote><p>+</p></blockquote>'],
  ['> a\n+\n```\n\n> +\n\n',
    '<blockquote><p>a</p><pre><code></code></pre></blockquote><blockquote><p>+</p></blockquote>'],
  ['> a\n+\n```\nx\n\n>  +\n\n',
    '<blockquote><p>a</p><pre><code>x\n</code></pre></blockquote><blockquote><p>+</p></blockquote>'],
  ['- > a\n  +\n  ```\n\n  > +\n\n\n',
    '<ul><li><blockquote><p>a</p><pre><code></code></pre></blockquote><blockquote><p>+</p></blockquote></li></ul>'],
])('a quote plus that attaches nothing stays text: %j', (source, html) => {
  expect(tight(carveToHtml(source))).toBe(html)
})
