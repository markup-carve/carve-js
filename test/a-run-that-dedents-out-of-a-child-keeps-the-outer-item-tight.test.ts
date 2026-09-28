import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve-js#2230, PART 9 §17 L1 / L1a (CARVE-P9-029): the item holds
// a paragraph, a child list and one code block, so it holds no second paragraph
// and stays tight. The item-looseness precompute asked §10's closer lookahead
// about a paragraph the CHILD held open, so the run refused to latch and the
// blank inside the block it opens read as an interior separator.
describe('a fence run that dedents out of a child keeps the outer item tight', () => {
  it('the ticket case', () => {
    expect(carveToHtml('- outer\n  - head\n\n    ```\n    a\n  ```\n\n  tail\n')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ul>',
    )
  })

  it.each([
    ['a closer between the two content columns', '- outer\n  - head\n\n    ```\n    a\n   ```\n\n  tail\n'],
    ['a tilde run', '- outer\n  - head\n\n    ~~~\n    a\n   ~~~\n\n  tail\n'],
    ['an opener past the child content column', '- outer\n  - head\n\n        ```\n        a\n   ```\n\n  tail\n'],
    ['a trailing line at the child content column', '- outer\n  - head\n\n    ```\n    a\n   ```\n\n    tail\n'],
    ['a second child item above the run', '- outer\n  - one\n  - two\n\n    ```\n    a\n  ```\n\n  tail\n'],
  ])('%s keeps it tight', (_name, src) => {
    expect(carveToHtml(src)).toMatch(/^<ul>\n {2}<li>outer\n/)
  })

  it('an ordered outer item reads the same', () => {
    expect(carveToHtml('1. outer\n   - head\n\n     ```\n     a\n   ```\n\n   tail\n')).toBe(
      '<ol>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</ol>',
    )
  })

  it('a quote host reads the same', () => {
    expect(carveToHtml('> - outer\n>   - head\n>\n>     ```\n>     a\n>   ```\n>\n>   tail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>outer\n      <ul>\n        <li>head\n          <pre><code>a\n</code></pre>\n        </li>\n      </ul>\n      <pre><code>\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  // Without the blank the two runs fold into the child's paragraph as an inline
  // verbatim span, so the item still holds one paragraph and no block.
  it('a run absorbed into the child paragraph keeps it tight too', () => {
    expect(carveToHtml('- outer\n  - head\n    ```\n    a\n   ```\n\n  tail\n')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li>head\n<code>\na\n</code></li>\n    </ul>\n    tail\n  </li>\n</ul>',
    )
  })

  // CONTROLS. Every assertion above is a tight reading, so a pass that latched
  // every run would satisfy them all. These are what a too-wide fix breaks.
  it.each([
    ["the item's own second paragraph", '- outer\n  - head\n\n  one\n\n  two\n'],
    ['a plain paragraph below the child', '- outer\n  - head\n\n  tail\n'],
    ['a run that closes inside the child', '- outer\n  - head\n\n    ```\n    a\n    ```\n\n  tail\n'],
  ])('%s still loosens the outer list', (_name, src) => {
    expect(carveToHtml(src)).toMatch(/^<ul>\n {2}<li><p>outer<\/p>/)
  })
})
