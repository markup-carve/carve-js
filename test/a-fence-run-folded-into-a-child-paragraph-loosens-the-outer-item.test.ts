import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §17 L1 / L1a (#3267): tail is the outer item's second paragraph.
describe('a fence run folded into a child paragraph loosens the outer item', () => {
  const loose = (list: 'ul' | 'ol', child = 'head\n<code>\na\n</code>') =>
    `<${list}>\n  <li><p>outer</p>\n    <ul>\n      <li>${child}</li>\n    </ul>\n    <p>tail</p>\n  </li>\n</${list}>`

  it.each([
    ['backtick', '```'],
    ['tilde', '~~~'],
  ])('%s run', (_name, run) => {
    expect(carveToHtml(`- outer\n  - head\n    ${run}\n    a\n   ${run}\n\n  tail\n`)).toBe(
      loose('ul', run === '~~~' ? 'head\n~~~\na\n~~~' : undefined),
    )
  })

  it('ordered outer item', () => {
    expect(carveToHtml('1. outer\n   - head\n     ```\n     a\n    ```\n\n   tail\n')).toBe(loose('ol'))
  })

  it('quote host', () => {
    expect(carveToHtml('> - outer\n>   - head\n>     ```\n>     a\n>    ```\n>\n>   tail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li><p>outer</p>\n      <ul>\n        <li>head\n<code>\na\n</code></li>\n      </ul>\n      <p>tail</p>\n    </li>\n  </ul>\n</blockquote>',
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
