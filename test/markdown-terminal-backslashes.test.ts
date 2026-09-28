import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  [
    "foo\\",
    "<p>foo\\</p>"
  ],
  [
    "foo\\\n",
    "<p>foo\\</p>"
  ],
  [
    "foo\\\n\nbar",
    "<p>foo\\</p>\n<p>bar</p>"
  ],
  [
    "foo\\\nbar",
    "<p>foo<br>\nbar</p>"
  ],
  [
    "### foo\\\n",
    "<section id=\"foo\">\n  <h3>foo\\</h3>\n</section>"
  ],
  [
    "Foo\\\n---\n",
    "<section id=\"Foo\">\n  <h2>Foo\\</h2>\n</section>"
  ],
  [
    "Foo\nbar\\\n---\n",
    "<section id=\"Foo-bar\">\n  <h2>Foo bar\\</h2>\n</section>"
  ],
  [
    "> foo\\\n",
    "<blockquote><p>foo\\</p></blockquote>"
  ],
  [
    "- foo\\\n",
    "<ul>\n  <li>foo\\</li>\n</ul>"
  ],
  [
    "> a\\\nb",
    "<blockquote><p>a<br>\nb</p></blockquote>"
  ],
  [
    "- a\\\nb",
    "<ul>\n  <li>a<br>\nb</li>\n</ul>"
  ],
  [
    "- a\n  b\\\n  c",
    "<ul>\n  <li>a\nb<br>\nc</li>\n</ul>"
  ],
  [
    "- a\nb\\\nc",
    "<ul>\n  <li>a\nb<br>\nc</li>\n</ul>"
  ],
  [
    "a\n    b\\\n    c",
    "<p>a\nb<br>\nc</p>"
  ],
  [
    "> a\nb\\\nc",
    "<blockquote><p>a\nb<br>\nc</p></blockquote>"
  ],
  [
    "> a\\\n> ---",
    "<blockquote>\n  <h2 id=\"a\">a\\</h2>\n</blockquote>"
  ],
  [
    "- a\\\n  ---",
    "<ul>\n  <li>\n    <h2 id=\"a\">a\\</h2>\n  </li>\n</ul>"
  ],
  [
    "Foo\\\n    ---",
    "<p>Foo<br>\n---</p>"
  ]
])('preserves terminal backslashes and hard breaks in %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})
