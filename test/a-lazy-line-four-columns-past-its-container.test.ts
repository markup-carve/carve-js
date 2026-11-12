import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// markup-carve/carve#6020: a lazy line four or more columns past the container
// that still holds it opens no block (indented code cannot interrupt a
// paragraph), so it is written as text of the open paragraph. Expected HTML
// matches cmark-gfm 0.29.0.gfm.13 for the source (markup-carve/carve#2187).
describe('a lazy line four columns past its container stays paragraph text', () => {
  const cases: Array<[string, string, string, string]> = [
    [
      'ticket reproduction: a quote marker left of the item that holds the quote',
      '> 100. > a b\n>     > c\n',
      '> 100. > a b\n>      > \\> c\n',
      '<blockquote>\n  <ol start="100">\n    <li>\n      <blockquote><p>a b\n&gt; c</p></blockquote>\n    </li>\n  </ol>\n</blockquote>',
    ],
    [
      'an item line in the document, the lazy quote marker past the item',
      '- > a b\n      > d\n',
      '- > a b\n  > \\> d\n',
      '<ul>\n  <li>\n    <blockquote><p>a b\n&gt; d</p></blockquote>\n  </li>\n</ul>',
    ],
    [
      'quoted paragraph, quote marker four columns into the document',
      '> p q\n    > x\n',
      '> p q\n> \\> x\n',
      '<blockquote><p>p q\n&gt; x</p></blockquote>',
    ],
    [
      'second lazy line after a quote that leaves the item',
      '- 100. > a b\n    > c\n       > d\n',
      '- 100. > a b\n  > c\n  > \\> d\n',
      '<ul>\n  <li>\n    <ol start="100">\n      <li>\n        <blockquote><p>a b</p></blockquote>\n      </li>\n    </ol>\n    <blockquote><p>c\n&gt; d</p></blockquote>\n  </li>\n</ul>',
    ],
    [
      'definition-shaped lazy line in an item quote',
      '> - > p q\n    [r]: https://e\n',
      '> - > p q\n>   > \\[r]: [https://e](https://e)\n',
      '<blockquote>\n  <ul>\n    <li>\n      <blockquote><p>p q\n[r]: <a href="https://e">https://e</a></p></blockquote>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'fence left of the item that holds the quote',
      '> 100. > a b\n>     ```\n',
      '> 100. > a b\n>      > \\`\\`\\`\n',
      '<blockquote>\n  <ol start="100">\n    <li>\n      <blockquote><p>a b\n```</p></blockquote>\n    </li>\n  </ol>\n</blockquote>',
    ],
    [
      'fence left of the item that holds the paragraph',
      '> 100. a b\n>     ```\n',
      '> 100. a b\n>      \\`\\`\\`\n',
      '<blockquote>\n  <ol start="100">\n    <li>a b\n```</li>\n  </ol>\n</blockquote>',
    ],
    [
      'doubled marker line, quote marker four past the inner item',
      '> - - > a b\n>         > c\n',
      '> - - > a b\n>     > \\> c\n',
      '<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>\n          <blockquote><p>a b\n&gt; c</p></blockquote>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'doubled marker line, list marker left of the inner item',
      '> - 100. a b\n>       - c\n',
      '> - 100. a b\n>        \\- c\n',
      '<blockquote>\n  <ul>\n    <li>\n      <ol start="100">\n        <li>a b\n- c</li>\n      </ol>\n    </li>\n  </ul>\n</blockquote>',
    ],
  ]
  it.each(cases)('%s', (_name, markdown, carve, html) => {
    expect(markdownToCarve(markdown)).toBe(carve)
    expect(carveToHtml(carve)).toBe(html)
  })
})
