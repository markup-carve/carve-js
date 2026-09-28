import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  [
    "## \n#\n### ###\n",
    "<h2></h2>\n<h1></h1>\n<h3></h3>"
  ],
  [
    "before\n#\nafter",
    "<p>before</p>\n<h1></h1>\n<p>after</p>"
  ],
  [
    "    #\n",
    "<pre><code>#\n</code></pre>"
  ],
  [
    "#\n    code",
    "<h1></h1>\n<pre><code>code\n</code></pre>"
  ],
  [
    "1. item\n\n   #",
    "<ol>\n  <li><p>item</p>\n    <h1></h1>\n  </li>\n</ol>"
  ]
])('retains empty Markdown headings: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})

it.each(['\v', '\f', '\u00a0'])('keeps non-padding whitespace in a heading: %j', content => {
  expect(markdownToCarve('# ' + content)).toBe('# ' + content)
})
