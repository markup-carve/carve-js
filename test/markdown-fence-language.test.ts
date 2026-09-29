import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve, parse, renderPlainText } from '../src/index.js'

it.each([
  [
    "```&#99;\nx\n```",
    "<pre><code class=\"language-c\">x\n</code></pre>"
  ],
  [
    "```c\\#\nx\n```",
    "<pre><code class=\"language-c#\">x\n</code></pre>"
  ],
  [
    "```a b\nx\n```",
    "<pre><code>x\n</code></pre>"
  ]
,
  [
    "``` f&ouml;&ouml;\nfoo\n```\n",
    "<pre><code>foo\n</code></pre>"
  ],
  [
    "````;\n````\n",
    "<pre><code>\n</code></pre>"
  ],
  [
    "```=html\n<script>x</script>\n```",
    "<pre><code>&lt;script&gt;x&lt;/script&gt;\n</code></pre>"
  ],
  [
    "~~~a`b\nx\n~~~",
    "<pre><code>x\n</code></pre>"
  ],
  [
    "```a\"b\n\"x\"\n```",
    "<pre><code>\"x\"\n</code></pre>"
  ],
  [
    "```c++ title=x\nx\n```",
    "<pre><code class=\"language-c++\">x\n</code></pre>"
  ],
  [
    "- ```föö\n  x\n  ```",
    "<ul>\n  <li>\n    <pre><code>x\n</code></pre>\n  </li>\n</ul>"
  ],
  [
    "> ```föö\n> x\n> ```",
    "<blockquote>\n  <pre><code>x\n</code></pre>\n</blockquote>"
  ]
])('keeps Markdown code with unsupported language hints: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})

it('keeps code in plain text when its language cannot be represented', () => {
  const source = markdownToCarve('```föö\nx = 1\n```')
  expect(renderPlainText(parse(source))).toBe('x = 1\n')
  expect(carveToHtml(source, { allowRawHtml: false })).toBe('<pre><code>x = 1\n</code></pre>')
})
