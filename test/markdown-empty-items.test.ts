import { expect, it } from 'vitest'
import { parseFragment, serialize } from 'parse5'
import { carveToHtml, markdownToCarve } from '../src/index.js'

const normalized = (html: string): string => serialize(parseFragment(html.replace(/>\s+</g, '><').trim()))

it.each([
  [
    "-   \n  foo\n",
    "<ul>\n<li>foo</li>\n</ul>\n"
  ],
  [
    "-\n\n  foo\n",
    "<ul>\n<li></li>\n</ul>\n<p>foo</p>\n"
  ],
  [
    "- foo\n-\n- bar\n",
    "<ul>\n<li>foo</li>\n<li></li>\n<li>bar</li>\n</ul>\n"
  ],
  [
    "- foo\n-   \n- bar\n",
    "<ul>\n<li>foo</li>\n<li></li>\n<li>bar</li>\n</ul>\n"
  ],
  [
    "1. foo\n2.\n3. bar\n",
    "<ol>\n<li>foo</li>\n<li></li>\n<li>bar</li>\n</ol>\n"
  ],
  [
    "*\n",
    "<ul>\n<li></li>\n</ul>\n"
  ],
  [
    "text\n-\n",
    "<section id=\"text\"><h2>text</h2></section>"
  ],
  [
    "    -\n",
    "<pre><code>-\n</code></pre>"
  ],
  [
    "```\n-\n```",
    "<pre><code>-\n</code></pre>"
  ]
])('preserves empty list items: %s', (source, expected) => {
  expect(normalized(carveToHtml(markdownToCarve(source)))).toBe(normalized(expected))
})
