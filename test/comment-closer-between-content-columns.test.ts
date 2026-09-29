import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Expected HTML from spec main 0a068ca04008d04e59e181e55455e65bd45f2e57.
// Covers carve-js#2243 and #2289, including adjacent passing shapes. The cases
// whose tail folds below its item's content column read LOOSE since
// markup-carve/carve#2558 ruled §17 L1 at every column the item's own paragraph
// text reaches; b1a592379 read them tight (carve-js#2330).
const cases = [
  {
    name: "child column 4, closer 3, tail 4, blanks 0/1",
    source: "- outer\n  - head\n    %%%\n    a\n   %%%\n\n    tail\n",
    html: "<ul>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ul>",
  },
  {
    name: "child column 4, closer 3, tail 4, blanks 1/0",
    source: "- outer\n  - head\n\n    %%%\n    a\n   %%%\n    tail\n",
    html: "<ul>\n  <li>outer\n    <ul>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 4, closer 3, tail 4, blanks 1/1",
    source: "- outer\n  - head\n\n    %%%\n    a\n   %%%\n\n    tail\n",
    html: "<ul>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 3, tail 4, blanks 0/0",
    source: "- a\n  - outer\n    - head\n      %%%\n      a\n   %%%\n    tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li>head</li>\n        </ul>\n        tail\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 3, tail 4, blanks 0/1",
    source: "- a\n  - outer\n    - head\n      %%%\n      a\n   %%%\n\n    tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li>head</li>\n        </ul>\n      </li>\n    </ul>\n    tail\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 3, tail 4, blanks 1/0",
    source: "- a\n  - outer\n    - head\n\n      %%%\n      a\n   %%%\n    tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li>head</li>\n        </ul>\n        tail\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 3, tail 6, blanks 1/0",
    source: "- a\n  - outer\n    - head\n\n      %%%\n      a\n   %%%\n      tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li><p>head</p>\n            <p>tail</p>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 3, tail 4, blanks 1/1",
    source: "- a\n  - outer\n    - head\n\n      %%%\n      a\n   %%%\n\n    tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li>head</li>\n        </ul>\n      </li>\n    </ul>\n    tail\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 5, tail 6, blanks 0/1",
    source: "- a\n  - outer\n    - head\n      %%%\n      a\n     %%%\n\n      tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li>head</li>\n        </ul>\n        tail\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 5, tail 6, blanks 1/0",
    source: "- a\n  - outer\n    - head\n\n      %%%\n      a\n     %%%\n      tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li><p>head</p>\n            <p>tail</p>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 5, tail 6, blanks 1/1",
    source: "- a\n  - outer\n    - head\n\n      %%%\n      a\n     %%%\n\n      tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li>head</li>\n        </ul>\n        tail\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 5, closer 4, tail 5, blanks 0/1",
    source: "1. outer\n   - head\n     %%%\n     a\n    %%%\n\n     tail\n",
    html: "<ol>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ol>",
  },
  {
    name: "child column 5, closer 4, tail 5, blanks 1/0",
    source: "1. outer\n   - head\n\n     %%%\n     a\n    %%%\n     tail\n",
    html: "<ol>\n  <li>outer\n    <ul>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ol>",
  },
  {
    name: "child column 5, closer 4, tail 5, blanks 1/1",
    source: "1. outer\n   - head\n\n     %%%\n     a\n    %%%\n\n     tail\n",
    html: "<ol>\n  <li>outer\n    <ul>\n      <li>head</li>\n    </ul>\n    tail\n  </li>\n</ol>",
  },
  {
    name: "child column 5, closer 3, tail 5, blanks 0/1",
    source: "- outer\n  1. head\n     %%%\n     a\n   %%%\n\n     tail\n",
    html: "<ul>\n  <li>outer\n    <ol>\n      <li>head</li>\n    </ol>\n    tail\n  </li>\n</ul>",
  },
  {
    name: "child column 5, closer 3, tail 5, blanks 1/0",
    source: "- outer\n  1. head\n\n     %%%\n     a\n   %%%\n     tail\n",
    html: "<ul>\n  <li>outer\n    <ol>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ol>\n  </li>\n</ul>",
  },
  {
    name: "child column 5, closer 3, tail 5, blanks 1/1",
    source: "- outer\n  1. head\n\n     %%%\n     a\n   %%%\n\n     tail\n",
    html: "<ul>\n  <li>outer\n    <ol>\n      <li>head</li>\n    </ol>\n    tail\n  </li>\n</ul>",
  },
  {
    name: "child column 5, closer 4, tail 5, blanks 0/1",
    source: "- outer\n  1. head\n     %%%\n     a\n    %%%\n\n     tail\n",
    html: "<ul>\n  <li>outer\n    <ol>\n      <li>head</li>\n    </ol>\n    tail\n  </li>\n</ul>",
  },
  {
    name: "child column 5, closer 4, tail 5, blanks 1/0",
    source: "- outer\n  1. head\n\n     %%%\n     a\n    %%%\n     tail\n",
    html: "<ul>\n  <li>outer\n    <ol>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ol>\n  </li>\n</ul>",
  },
  {
    name: "child column 5, closer 4, tail 5, blanks 1/1",
    source: "- outer\n  1. head\n\n     %%%\n     a\n    %%%\n\n     tail\n",
    html: "<ul>\n  <li>outer\n    <ol>\n      <li>head</li>\n    </ol>\n    tail\n  </li>\n</ul>",
  },
  {
    name: "child column 4, closer 1, tail 6, blanks 1/1",
    source: "- outer\n  - head\n\n    %%%\n    a\n %%%\n\n      tail\n",
    html: "<ul>\n  <li>outer\n    <ul>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 4, closer 3, tail 6, blanks 1/1",
    source: "- outer\n  - head\n\n    %%%\n    a\n   %%%\n\n      tail\n",
    html: "<ul>\n  <li>outer\n    <ul>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 1, tail 8, blanks 1/1",
    source: "- a\n  - outer\n    - head\n\n      %%%\n      a\n %%%\n\n        tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li><p>head</p>\n            <p>tail</p>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 3, tail 8, blanks 1/1",
    source: "- a\n  - outer\n    - head\n\n      %%%\n      a\n   %%%\n\n        tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li><p>head</p>\n            <p>tail</p>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 6, closer 5, tail 8, blanks 1/1",
    source: "- a\n  - outer\n    - head\n\n      %%%\n      a\n     %%%\n\n        tail\n",
    html: "<ul>\n  <li>a\n    <ul>\n      <li>outer\n        <ul>\n          <li><p>head</p>\n            <p>tail</p>\n          </li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>",
  },
  {
    name: "child column 5, closer 1, tail 7, blanks 1/1",
    source: "1. outer\n   - head\n\n     %%%\n     a\n %%%\n\n       tail\n",
    html: "<ol>\n  <li>outer\n    <ul>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ol>",
  },
  {
    name: "child column 5, closer 4, tail 7, blanks 1/1",
    source: "1. outer\n   - head\n\n     %%%\n     a\n    %%%\n\n       tail\n",
    html: "<ol>\n  <li>outer\n    <ul>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ul>\n  </li>\n</ol>",
  },
  {
    name: "child column 5, closer 1, tail 7, blanks 1/1",
    source: "- outer\n  1. head\n\n     %%%\n     a\n %%%\n\n       tail\n",
    html: "<ul>\n  <li>outer\n    <ol>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ol>\n  </li>\n</ul>",
  },
  {
    name: "child column 5, closer 3, tail 7, blanks 1/1",
    source: "- outer\n  1. head\n\n     %%%\n     a\n   %%%\n\n       tail\n",
    html: "<ul>\n  <li>outer\n    <ol>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ol>\n  </li>\n</ul>",
  },
  {
    name: "child column 5, closer 4, tail 7, blanks 1/1",
    source: "- outer\n  1. head\n\n     %%%\n     a\n    %%%\n\n       tail\n",
    html: "<ul>\n  <li>outer\n    <ol>\n      <li><p>head</p>\n        <p>tail</p>\n      </li>\n    </ol>\n  </li>\n</ul>",
  },
]

describe('a comment closer between item content columns', () => {
  for (const width of [3, 4]) {
    for (const extra of [0, 1, 2, 4]) {
      it.each(cases)(`$name (fence ${width}, extra indent ${extra})`, ({ source, html }) => {
        const lines = source.replace(/%{3}/g, '%'.repeat(width)).split('\n')
        const opener = lines.findIndex((line) => line.includes('%%%'))
        lines[opener] = ' '.repeat(extra) + lines[opener]
        lines[opener + 1] = ' '.repeat(extra) + lines[opener + 1]
        expect(carveToHtml(lines.join('\n'))).toBe(html)
      })
    }
  }
})

for (const sibling of [false, true]) {
  it.each([
    ['line comment', '  %% n\n'],
    ['span closed at the content column', '  %%%\n  n\n  %%%\n'],
    ['span closed below the content column', '  %%%\n  n\n %%%\n'],
    ['span closed at column zero', '  %%%\n  n\n%%%\n'],
  ])(`reads a blank before a %s (sibling ${sibling})`, (_name, comment) => {
    // The band tail is the item's own second paragraph either way; a sibling
    // marker is not what the blank has to separate (carve#2548, corpus 517).
    expect(carveToHtml('- a\n\n' + comment + ' tail\n' + (sibling ? '- b\n' : ''))).toBe(
      '<ul>\n  <li><p>a</p>\n    <p>tail</p>\n  </li>\n' +
        (sibling ? '  <li><p>b</p></li>\n' : '') +
        '</ul>',
    )
  })
}

it('keeps a descendant blank from loosening the host before its sibling', () => {
  expect(carveToHtml('- outer\n  - a\n\n    %%%\n    n\n   %%%\n tail\n- b\n')).toBe(
    '<ul>\n  <li>outer\n    <ul>\n      <li>a</li>\n    </ul>\n    tail\n  </li>\n  <li>b</li>\n</ul>',
  )
})
