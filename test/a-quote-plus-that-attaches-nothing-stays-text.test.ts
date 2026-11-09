import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The still-open attached fence reads a quoted `+` as payload (carve#5658 F06).
const tight = (html: string): string => html.replace(/>\s+</g, '><').trim()

it.each([
  ['> a\n+\n```\n\n> +\n\n\n',
    '<blockquote><p>a</p><pre><code>\n+\n\n\n</code></pre></blockquote>'],
  ['> a\n+\n```\n\n> +\n\n',
    '<blockquote><p>a</p><pre><code>\n+\n\n</code></pre></blockquote>'],
  ['> a\n+\n```\nx\n\n>  +\n\n',
    '<blockquote><p>a</p><pre><code>x\n\n +\n\n</code></pre></blockquote>'],
  ['- > a\n  +\n  ```\n\n  > +\n\n\n',
    '<ul><li><blockquote><p>a</p><pre><code>\n+\n\n\n</code></pre></blockquote></li></ul>'],
])('a quoted plus in an open attached fence stays payload: %j', (source, html) => {
  expect(tight(carveToHtml(source))).toBe(html)
})
