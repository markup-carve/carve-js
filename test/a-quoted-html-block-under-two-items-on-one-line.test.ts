import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// markup-carve/carve-js#5005: a quoted line that opens two items holds its
// content at the inner item, so an HTML block at that column stays there.
// Expected HTML matches cmark-gfm 0.29.0.gfm.13 (markup-carve/carve#2187).
describe('a quoted HTML block under a line that opens two items stays in the inner item', () => {
  const cases: Array<[string, string, string, string]> = [
    [
      'ticket reproduction: a bullet then an ordered marker',
      '> - 1. a b\n>      <div>c</div>\n',
      '> - 1. a b\n>      ```=html\n>      <div>c</div>\n>      ```\n',
      '<blockquote>\n  <ul>\n    <li>\n      <ol>\n        <li>a b\n          <div>c</div>\n        </li>\n      </ol>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'a quote in the inner item',
      '> - 1. > # h\n>      <div>c</div>\n',
      '> - 1. > # h\n>      ```=html\n>      <div>c</div>\n>      ```\n',
      '<blockquote>\n  <ul>\n    <li>\n      <ol>\n        <li>\n          <blockquote>\n            <h1 id="h">h</h1>\n          </blockquote>\n          <div>c</div>\n        </li>\n      </ol>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'two bullets',
      '> - - a b\n>     <div>c</div>\n',
      '> - - a b\n>     ```=html\n>     <div>c</div>\n>     ```\n',
      '<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>a b\n          <div>c</div>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>',
    ],
    [
      'an ordered marker then a bullet',
      '> 1. - a b\n>      <div>c</div>\n',
      '> 1. - a b\n>      ```=html\n>      <div>c</div>\n>      ```\n',
      '<blockquote>\n  <ol>\n    <li>\n      <ul>\n        <li>a b\n          <div>c</div>\n        </li>\n      </ul>\n    </li>\n  </ol>\n</blockquote>',
    ],
  ]
  it.each(cases)('%s', (_name, markdown, carve, html) => {
    expect(markdownToCarve(markdown)).toBe(carve)
    expect(carveToHtml(carve)).toBe(html)
  })
})
