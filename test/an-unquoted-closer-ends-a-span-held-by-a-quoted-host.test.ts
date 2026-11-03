import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// An unquoted exact-width `%%%` closes a span an item, description or note holds in a quote, as it does a quote's own span (PART 0 S1, ruling on carve#5027).
// Each output is the spec model's for the same document with the closer written inside the quote.
describe('an unquoted closer ends a span held by a quoted host', () => {
  it.each([
    [
      "a span on its own line in a quoted item",
      "> - a\n>   %%%\n%%%\nc\n",
      "<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>\n<p>c</p>",
    ],
    [
      "a span with payload in a quoted item",
      "> - a\n>   %%%\n>   body\n%%%\ntail\n",
      "<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>\n<p>tail</p>",
    ],
    [
      "a span on a quoted item marker line",
      "> - %%%\n%%%\nc\n",
      "<blockquote>\n  <ul>\n    <li></li>\n  </ul>\n</blockquote>\n<p>c</p>",
    ],
    [
      "a span on a quoted description lead",
      "> :: u\n> : %%%\n%%%\nc\n",
      "<blockquote>\n  <dl>\n    <dt>u</dt>\n    <dd></dd>\n  </dl>\n</blockquote>\n<p>c</p>",
    ],
    [
      "an indented closer",
      "> - a\n>   %%%\n  %%%\nc\n",
      "<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>\n<p>c</p>",
    ],
    [
      "a quoted line after the closer stays in the quote",
      "> - a\n>   %%%\n%%%\n> c\n",
      "<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n  <p>c</p>\n</blockquote>",
    ],
    [
      "a quoted item two quotes deep",
      "> > - a\n> >   %%%\n%%%\nc\n",
      "<blockquote>\n  <blockquote>\n    <ul>\n      <li>a</li>\n    </ul>\n  </blockquote>\n</blockquote>\n<p>c</p>",
    ],
    [
      "lines after the closer of a marker-line span stay in the item",
      "> - %%%\n%%%\n>   c\ntail\n",
      "<blockquote>\n  <ul>\n    <li>c\ntail</li>\n  </ul>\n</blockquote>",
    ],
    [
      "a note span in a quote, then its body",
      "> [^n]: x\n>   %%%\n%%%\n>   c\ntail\n",
      "<blockquote>\n\n</blockquote>",
    ],
    [
      "a closer of the wrong width ends the span and opens its own",
      "> - a\n>   %%%\n%%%%\nc\n",
      "<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
