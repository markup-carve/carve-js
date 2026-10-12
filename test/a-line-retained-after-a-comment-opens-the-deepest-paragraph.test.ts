import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('a line retained after a comment opens the deepest paragraph', () => {
  it('folds an unprefixed tail into the inner item', () => {
    const source = ['- a', '  - inner', '    %% c', '   code', 'tail'].join('\n')
    expect(carveToHtml(source)).toBe('<ul>\n  <li>a\n    <ul>\n      <li>inner\n        code\ntail\n      </li>\n    </ul>\n  </li>\n</ul>')
  })

  it.each(['inner', '::: inner'])('folds a lazy marker into quoted %s text after a comment span', (inner) => {
    const source = ['> - ::: box', `>   - ${inner}`, '>     %%%', '>     hidden', '>     %%%', '>    ```', '>    code', '- tail'].join('\n')
    const html = carveToHtml(source)
    expect(html).toContain('<code>\ncode\n- tail</code>')
    expect(html.match(/<blockquote>/g)).toHaveLength(1)
    expect(html.endsWith('</blockquote>')).toBe(true)
  })
})

it('ends a quoted code block when the quote prefix is absent', () => {
  const source = ['> - a', '>   - inner', '>     %% c', '>    ```', '>    code', 'tail'].join('\n')
  expect(carveToHtml(source)).toContain('<pre><code>code\n</code></pre>')
  expect(carveToHtml(source)).toContain('</blockquote>\n<p>tail</p>')
})

it('retains a marker after a comment without claiming document text', () => {
  const source = ['- a', '  - inner', '    %% c', '   - x', 'tail'].join('\n')
  expect(carveToHtml(source)).toContain('inner\n        - x')
  expect(carveToHtml(source)).toContain('</ul>\n<p>tail</p>')
})

it.each(['- tail', '* tail', '1. tail', 'a) tail'])('preserves inline code continuation %s in the writer', (marker) => {
  const source = ['> - ::: box', '>   - inner', '>     %%%', '>     hidden', '>     %%%', '>    ```', '>    code', marker].join('\n')
  expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
})

it('preserves a marker follower already owned by an ancestor', () => {
  const source = ['- a', '  - b', '    - inner', '      %% c', '     - x', 'tail'].join('\n')
  expect(carveToHtml(source)).toContain('inner\n            - x\ntail')
  expect(carveToHtml(source)).not.toContain('<p>tail</p>')
})
