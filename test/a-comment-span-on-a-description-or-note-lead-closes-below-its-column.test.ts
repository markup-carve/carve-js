import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A %%% span on a `: ` or `[^n]: ` lead belongs to that body: a closer below the column closes it, and a blank inside it is payload (carve#4996). Outputs are the spec model's.
describe('a comment span on a description or note lead closes below its column', () => {
  it.each([
    [
      "a description in an item, closer at column 0",
      "- a\n  :: u\n  : %%%\n%%%\nc\n",
      "<ul>\n  <li>a\n    <dl>\n      <dt>u</dt>\n      <dd></dd>\n    </dl>\n  </li>\n</ul>\n<p>c</p>",
    ],
    [
      "a note in an item, closer at column 0",
      "- a\n\n  [^n]: %%%\n%%%\nc\n",
      "<ul>\n  <li>a</li>\n</ul>\n<p>c</p>",
    ],
    [
      "a blank inside a top-level description span",
      ":: u\n: %%%\n    n\n\n%%%\nc\n",
      "<dl>\n  <dt>u</dt>\n  <dd></dd>\n</dl>\n<p>c</p>",
    ],
    [
      "a blank inside the span, follower at the item column",
      "- a\n  :: u\n  : %%%\n\n%%%\n  c\n",
      "<ul>\n  <li>a\n    <dl>\n      <dt>u</dt>\n      <dd></dd>\n    </dl>\n    c\n  </li>\n</ul>",
    ],
    [
      "a blank inside a top-level note span",
      "x[^n]\n\n[^n]: %%%\n    n\n\n%%%\nc\n",
      "<p>x<a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<p>c</p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      "a blank inside a nested item span",
      "- a\n  - %%%\n    n\n\n%%%\nc\n",
      "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>c</p>",
    ],
    [
      "a description in a quoted item",
      "> - a\n>   :: u\n>   : %%%\n> %%%\n> c\n",
      "<blockquote>\n  <ul>\n    <li>a\n      <dl>\n        <dt>u</dt>\n        <dd></dd>\n      </dl>\n    </li>\n  </ul>\n  <p>c</p>\n</blockquote>",
    ],
    [
      "a description in an ordered item",
      "1. a\n   :: u\n   : %%%%\n%%%%\nc\n",
      "<ol>\n  <li>a\n    <dl>\n      <dt>u</dt>\n      <dd></dd>\n    </dl>\n  </li>\n</ol>\n<p>c</p>",
    ],
    [
      "a note in a nested item",
      "- a\n  - b\n    [^n]: %%%\n%%%\nc\n",
      "<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>\n<p>c</p>",
    ],
    [
      "a comment line in the span, then a line that misses the item",
      "- a\n  :: u\n  : %%%\n%% c\nc\n",
      "<ul>\n  <li>a\n    <dl>\n      <dt>u</dt>\n      <dd></dd>\n    </dl>\n  </li>\n</ul>\n<p>c</p>",
    ],
    [
      "a comment line in a note span, then a line that misses the item",
      "- a\n  [^n]: %%%\n%% c\nc\n",
      "<ul>\n  <li>a</li>\n</ul>\n<p>c</p>",
    ],
    [
      "a line at the item column ends the span",
      "- a\n  :: u\n  : %%%\n  zz\nc\n",
      "<ul>\n  <li>a\n    <dl>\n      <dt>u</dt>\n      <dd></dd>\n    </dl>\n    zz\nc\n  </li>\n</ul>",
    ],
    [
      "a blank, then a line at the item column, loosens the list",
      "- a\n  :: u\n  : %%%\n\n  c\n",
      "<ul>\n  <li><p>a</p>\n    <dl>\n      <dt>u</dt>\n      <dd></dd>\n    </dl>\n    <p>c</p>\n  </li>\n</ul>",
    ],
    [
      "a blank in a note span, then a line at the item column",
      "- a\n  [^n]: %%%\n    n\n\n  c\n",
      "<ul>\n  <li><p>a</p>\n    <p>c</p>\n  </li>\n</ul>",
    ],
    [
      "CONTROL: a note span that a line below its body ends",
      "- a\n\n  [^g]: %%%\n    n\n  zz\n%%%\n\nx[^g]\n",
      "<ul>\n  <li><p>a</p>\n    <p>zz</p>\n  </li>\n</ul>",
    ],
    [
      "CONTROL: a span on a description body line",
      "- a\n  :: u\n  : x\n    %%%\n%%%\n:: c\n",
      "<ul>\n  <li>a\n    <dl>\n      <dt>u</dt>\n      <dd>x</dd>\n    </dl>\n  </li>\n</ul>\n<dl>\n  <dt>c</dt>\n</dl>",
    ],
    [
      "CONTROL: a span on a list marker line",
      "- a\n  - %%%\n%%%\nc\n",
      "<ul>\n  <li>a\n    <ul>\n      <li></li>\n    </ul>\n  </li>\n</ul>\n<p>c</p>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
