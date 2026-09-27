import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Expectations verified with the layout and HTML oracle at spec 8017328e.

const cases = [
  [
    'item: colon closer below',
    '- head\n\n      :::\n      a\n    :::\n\n  tail\n',
    '<ul>\n  <li>head\n    <div>\n      <p>a\n:::</p>\n      <p>tail</p>\n    </div>\n  </li>\n</ul>',
  ],
  [
    'item: colon closer at-base',
    '- head\n\n      :::\n      a\n      :::\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    <div>\n      <p>a</p>\n    </div>\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'item: colon closer past-base',
    '- head\n\n      :::\n      a\n        :::\n\n  tail\n',
    '<ul>\n  <li>head\n    <div>\n      <p>a\n:::</p>\n      <p>tail</p>\n    </div>\n  </li>\n</ul>',
  ],
  [
    'item: colon closer at-content',
    '- head\n\n      :::\n      a\n  :::\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    <div>\n      <p>a</p>\n    </div>\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'item: below-base ::: does not change nesting',
    '- head\n\n      :::\n      a\n    :::\n      b\n      :::\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    <div>\n      <p>a\n:::\nb</p>\n    </div>\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'item: below-base :::: does not change nesting',
    '- head\n\n      :::\n      a\n    ::::\n      b\n      :::\n\n  tail\n',
    '<ul>\n  <li><p>head</p>\n    <div>\n      <p>a\n::::\nb</p>\n    </div>\n    <p>tail</p>\n  </li>\n</ul>',
  ],
  [
    'item: nested exact-width colon closers',
    '- head\n\n      :::\n      ::::\n      a\n    ::::\n      ::::\n      b\n      :::\n',
    '<ul>\n  <li>head\n    <div>\n      <div>\n        <p>a\n::::</p>\n      </div>\n      <p>b</p>\n    </div>\n  </li>\n</ul>',
  ],
  [
    'nested: colon closer below',
    '- outer\n\n  - inner\n\n        :::\n        a\n      :::\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <div>\n          <p>a\n:::</p>\n          <p>tail</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: colon closer at-base',
    '- outer\n\n  - inner\n\n        :::\n        a\n        :::\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        <div>\n          <p>a</p>\n        </div>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: colon closer past-base',
    '- outer\n\n  - inner\n\n        :::\n        a\n          :::\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <div>\n          <p>a\n:::</p>\n          <p>tail</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: colon closer at-content',
    '- outer\n\n  - inner\n\n        :::\n        a\n    :::\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        <div>\n          <p>a</p>\n        </div>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: below-base ::: does not change nesting',
    '- outer\n\n  - inner\n\n        :::\n        a\n      :::\n        b\n        :::\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        <div>\n          <p>a\n:::\nb</p>\n        </div>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: below-base :::: does not change nesting',
    '- outer\n\n  - inner\n\n        :::\n        a\n      ::::\n        b\n        :::\n\n    tail\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li><p>inner</p>\n        <div>\n          <p>a\n::::\nb</p>\n        </div>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'nested: nested exact-width colon closers',
    '- outer\n\n  - inner\n\n        :::\n        ::::\n        a\n      ::::\n        ::::\n        b\n        :::\n',
    '<ul>\n  <li>outer\n    <ul>\n      <li>inner\n        <div>\n          <div>\n            <p>a\n::::</p>\n          </div>\n          <p>b</p>\n        </div>\n      </li>\n    </ul>\n  </li>\n</ul>',
  ],
  [
    'quoteitem: colon closer below',
    '> - head\n>\n>       :::\n>       a\n>     :::\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <div>\n        <p>a\n:::</p>\n        <p>tail</p>\n      </div>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: colon closer at-base',
    '> - head\n>\n>       :::\n>       a\n>       :::\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      <div>\n        <p>a</p>\n      </div>\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: colon closer past-base',
    '> - head\n>\n>       :::\n>       a\n>         :::\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <div>\n        <p>a\n:::</p>\n        <p>tail</p>\n      </div>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: colon closer at-content',
    '> - head\n>\n>       :::\n>       a\n>   :::\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      <div>\n        <p>a</p>\n      </div>\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: below-base ::: does not change nesting',
    '> - head\n>\n>       :::\n>       a\n>     :::\n>       b\n>       :::\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      <div>\n        <p>a\n:::\nb</p>\n      </div>\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: below-base :::: does not change nesting',
    '> - head\n>\n>       :::\n>       a\n>     ::::\n>       b\n>       :::\n> \n>   tail\n',
    '<blockquote>\n  <ul>\n    <li><p>head</p>\n      <div>\n        <p>a\n::::\nb</p>\n      </div>\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'quoteitem: nested exact-width colon closers',
    '> - head\n>\n>       :::\n>       ::::\n>       a\n>     ::::\n>       ::::\n>       b\n>       :::\n',
    '<blockquote>\n  <ul>\n    <li>head\n      <div>\n        <div>\n          <p>a\n::::</p>\n        </div>\n        <p>b</p>\n      </div>\n    </li>\n  </ul>\n</blockquote>',
  ],
  [
    'fn: colon closer below',
    'x[^1]\n\n[^1]: note\n\n      :::\n      a\n    :::\n\n  tail\n',
    '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>note</p>\n      <div>\n        <p>a\n:::</p>\n        <p>tail</p>\n      </div>\n      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  ],
  [
    'fn: colon closer at-base',
    'x[^1]\n\n[^1]: note\n\n      :::\n      a\n      :::\n\n  tail\n',
    '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>note</p>\n      <div>\n        <p>a</p>\n      </div>\n      <p>tail<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  ],
  [
    'fn: colon closer past-base',
    'x[^1]\n\n[^1]: note\n\n      :::\n      a\n        :::\n\n  tail\n',
    '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>note</p>\n      <div>\n        <p>a\n:::</p>\n        <p>tail</p>\n      </div>\n      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  ],
  [
    'fn: colon closer at-content',
    'x[^1]\n\n[^1]: note\n\n      :::\n      a\n  :::\n\n  tail\n',
    '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>note</p>\n      <div>\n        <p>a</p>\n      </div>\n      <p>tail<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  ],
  [
    'fn: below-base ::: does not change nesting',
    'x[^1]\n\n[^1]: note\n\n      :::\n      a\n    :::\n      b\n      :::\n\n  tail\n',
    '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>note</p>\n      <div>\n        <p>a\n:::\nb</p>\n      </div>\n      <p>tail<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  ],
  [
    'fn: below-base :::: does not change nesting',
    'x[^1]\n\n[^1]: note\n\n      :::\n      a\n    ::::\n      b\n      :::\n\n  tail\n',
    '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>note</p>\n      <div>\n        <p>a\n::::\nb</p>\n      </div>\n      <p>tail<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  ],
  [
    'fn: nested exact-width colon closers',
    'x[^1]\n\n[^1]: note\n\n      :::\n      ::::\n      a\n    ::::\n      ::::\n      b\n      :::\n',
    '<p>x<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n      <p>note</p>\n      <div>\n        <div>\n          <p>a\n::::</p>\n        </div>\n        <p>b</p>\n      </div>\n      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n    </li>\n  </ol>\n</section>',
  ],
  [
    'desc: colon closer below',
    ':: t\n:  desc\n\n       :::\n       a\n     :::\n\n   tail\n',
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>desc</p>\n    <div>\n      <p>a\n:::</p>\n      <p>tail</p>\n    </div>\n  </dd>\n</dl>',
  ],
  [
    'desc: colon closer at-base',
    ':: t\n:  desc\n\n       :::\n       a\n       :::\n\n   tail\n',
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>desc</p>\n    <div>\n      <p>a</p>\n    </div>\n    <p>tail</p>\n  </dd>\n</dl>',
  ],
  [
    'desc: colon closer past-base',
    ':: t\n:  desc\n\n       :::\n       a\n         :::\n\n   tail\n',
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>desc</p>\n    <div>\n      <p>a\n:::</p>\n      <p>tail</p>\n    </div>\n  </dd>\n</dl>',
  ],
  [
    'desc: colon closer at-content',
    ':: t\n:  desc\n\n       :::\n       a\n   :::\n\n   tail\n',
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>desc</p>\n    <div>\n      <p>a</p>\n    </div>\n    <p>tail</p>\n  </dd>\n</dl>',
  ],
  [
    'desc: below-base ::: does not change nesting',
    ':: t\n:  desc\n\n       :::\n       a\n     :::\n       b\n       :::\n\n   tail\n',
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>desc</p>\n    <div>\n      <p>a\n:::\nb</p>\n    </div>\n    <p>tail</p>\n  </dd>\n</dl>',
  ],
  [
    'desc: below-base :::: does not change nesting',
    ':: t\n:  desc\n\n       :::\n       a\n     ::::\n       b\n       :::\n\n   tail\n',
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>desc</p>\n    <div>\n      <p>a\n::::\nb</p>\n    </div>\n    <p>tail</p>\n  </dd>\n</dl>',
  ],
  [
    'desc: nested exact-width colon closers',
    ':: t\n:  desc\n\n       :::\n       ::::\n       a\n     ::::\n       ::::\n       b\n       :::\n',
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>desc</p>\n    <div>\n      <div>\n        <p>a\n::::</p>\n      </div>\n      <p>b</p>\n    </div>\n  </dd>\n</dl>',
  ],
] as const

describe('colon runs measured from their authored base', () => {
  for (const [name, source, expected] of cases) {
    it(name, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }
})
