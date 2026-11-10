import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A lazy `{%` run takes no lazy continuation (carve#5830 rule B, carve#5866).
describe('a lazy comment run continuation must reach its host body column', () => {
  it('refuses the run in a description', () => {
    expect(carveToHtml(':: t\n: pre\n{% b\n b %}\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>pre\n{% b\nb %}</dd>\n</dl>')
  })

  it('refuses the run in a nested item', () => {
    expect(carveToHtml('- a\n  - b\n  {% b\n   b %}\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n{% b\nb %}</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('refuses the run in a description nested in an item or led by a tab', () => {
    expect(carveToHtml('- a\n  :: t\n  : pre\n{% x\n   %}\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd>pre\n{% x\n%}</dd>\n    </dl>\n  </li>\n</ul>',
    )
    expect(carveToHtml('- a\n  :: t\n  : pre\n  {% x\n   %}\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd>pre\n{% x\n%}</dd>\n    </dl>\n  </li>\n</ul>',
    )
    expect(carveToHtml('\t:: t\n\t: pre\n{% x\n  %}\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>pre\n{% x\n%}</dd>\n</dl>')
  })

  it('keeps a run whose closer reaches the body column with text after it', () => {
    expect(carveToHtml(':: t\n: pre\n {% x\n  %} tail\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>pre\n tail</dd>\n</dl>')
  })

  it('keeps the run when the continuation reaches the body column', () => {
    expect(carveToHtml(':: t\n: pre\n{% b\n  b %}\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>pre\n</dd>\n</dl>')
    expect(carveToHtml('- a\n  - b\n  {% b\n    b %}\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
