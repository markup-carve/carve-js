import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Expected output read from the spec model at carve c2d2ed1.
const descriptionSublist = '<ul>\n  <li>\n    <dl>\n      <dt>term</dt>\n      <dd>\n        <p>payload</p>\n' +
  '        <ul>\n          <li>sub</li>\n        </ul>\n      </dd>\n    </dl>\n  </li>\n</ul>'
const looseAfterDescription = '<ul>\n  <li>\n    <dl>\n      <dt>term</dt>\n      <dd>\n        <p>payload</p>\n' +
  '        <pre><code></code></pre>\n      </dd>\n    </dl>\n    <p>text</p>\n  </li>\n</ul>'
const looseAfterSublist = '<ul>\n  <li>\n    <ul>\n      <li>a\n        <pre><code></code></pre>\n      </li>\n' +
  '    </ul>\n    <p>text</p>\n  </li>\n</ul>'

// carve-js#4226: an invisible line keeps an open description open (CARVE-P9-013).
describe('an invisible line inside an item description closes no description', () => {
  it.each([
    ['a comment line', '- :: term\n  : payload\n    %% c\n    - sub\n'],
    ['a comment line after a blank', '- :: term\n  : payload\n\n    %% c\n    - sub\n'],
    ['a comment line at the item column', '- :: term\n  : payload\n  %% c\n    - sub\n'],
    ['a closed comment span', '- :: term\n  : payload\n    %%%\n    x\n    %%%\n    - sub\n'],
    ['a link definition', '- :: term\n  : payload\n    [x]: /u\n    - sub\n'],
    ['an abbreviation definition', '- :: term\n  : payload\n    *[A]: b\n    - sub\n'],
  ])('%s', (_name, source) => {
    expect(carveToHtml(source).trim()).toBe(descriptionSublist)
  })

  it('still hands a marker at the item column to the item', () => {
    expect(carveToHtml('- :: term\n  : payload\n    %% c\n  - sub\n').trim()).toBe(
      '<ul>\n  <li>\n    <dl>\n      <dt>term</dt>\n      <dd>payload</dd>\n    </dl>\n    <ul>\n      <li>sub</li>\n' +
      '    </ul>\n  </li>\n</ul>')
  })
})

// carve-js#4227: an invisible line admits no block, so the blank after it separates (CARVE-P9-013 L1b).
describe('an invisible line after a fence leaves the blank after it a separator', () => {
  it.each([
    // An unclosed `%%%` hides the rest of the item (carve#4907).
    ['an unclosed comment opener', '- :: term\n  : payload\n    ~~~\n  %%%\n\n  text\n',
      '<ul>\n  <li>\n    <dl>\n      <dt>term</dt>\n      <dd>\n        <p>payload</p>\n        <pre><code></code></pre>\n      </dd>\n    </dl>\n  </li>\n</ul>'],
    ['a closed comment span', '- :: term\n  : payload\n    ~~~\n  %%%\n  x\n  %%%\n\n  text\n', looseAfterDescription],
    ['a link definition', '- :: term\n  : payload\n    ~~~\n  [x]: /u\n\n  text\n', looseAfterDescription],
    ['a footnote definition', '- :: term\n  : payload\n    ~~~\n  [^n]: note\n\n  text\n', looseAfterDescription],
    ['a braced comment in a quote', '> - :: term\n>   : payload\n>     ~~~\n>   {% c %}\n> \n>   text\n',
      `<blockquote>\n${looseAfterDescription.replace(/^/gm, '  ')}\n</blockquote>`],
    ['a definition that ends a sublist', '- - a\n    ~~~\n  [x]: /u\n\n    text\n', looseAfterSublist],
    ['a braced comment that ends a sublist', '- - a\n\n    ```\n  {% c %}\n\n    text\n', looseAfterSublist],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })
})
