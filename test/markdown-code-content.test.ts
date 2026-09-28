import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['>     a\n>       \n>     b', '<blockquote>\n  <pre><code>a\n  \nb\n</code></pre>\n</blockquote>'],
  ['    a\n      \n    b', '<pre><code>a\n  \nb\n</code></pre>'],
  ['    a\n  \n    b', '<pre><code>a\n\nb\n</code></pre>'],
  ['    a\n\t  \n    b', '<pre><code>a\n  \nb\n</code></pre>'],
  ['``` foo\\+bar\nx\n```', '<pre><code class="language-foo+bar">x\n</code></pre>'],
  ['``` f&#111;o\nx\n```', '<pre><code class="language-foo">x\n</code></pre>'],
])('preserves Markdown code content: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})
