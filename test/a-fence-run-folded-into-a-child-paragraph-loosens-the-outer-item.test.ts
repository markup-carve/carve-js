import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#4018: the fence interrupts the child paragraph, so the run below its column
// ends it and opens an unclosed fence in the outer item, which stays tight.
describe('a fence run below a child fence opens a fence in the outer item', () => {
  const tight = (list: 'ul' | 'ol') =>
    `<${list}>\n  <li>outer\n    <ul>\n      <li>head\n        <pre><code>a\n</code></pre>\n      </li>\n    </ul>\n    <pre><code>\ntail\n</code></pre>\n  </li>\n</${list}>`

  it.each([
    ['backtick', '```'],
    ['tilde', '~~~'],
  ])('%s run', (_name, run) => {
    expect(carveToHtml(`- outer\n  - head\n    ${run}\n    a\n   ${run}\n\n  tail\n`)).toBe(tight('ul'))
  })

  it('ordered outer item', () => {
    expect(carveToHtml('1. outer\n   - head\n     ```\n     a\n    ```\n\n   tail\n')).toBe(tight('ol'))
  })

  it('quote host', () => {
    expect(carveToHtml('> - outer\n>   - head\n>     ```\n>     a\n>    ```\n>\n>   tail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>outer\n      <ul>\n        <li>head\n          <pre><code>a\n</code></pre>\n        </li>\n      </ul>\n      <pre><code>\ntail\n</code></pre>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  // A blank before the run opens a block, so tail stays inside that block.
  it.each([
    ['backtick', '```'],
    ['tilde', '~~~'],
  ])('blank before %s run keeps the outer item tight', (_name, run) => {
    const html = carveToHtml(`- outer\n  - head\n\n    ${run}\n    a\n   ${run}\n\n  tail\n`)
    expect(html).toMatch(/^<ul>\n  <li>outer\n/)
  })
})
