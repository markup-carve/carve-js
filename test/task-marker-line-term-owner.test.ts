import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a separator at a task item content column leaves a deeper marker-line term', () => {
  it('returns the separator to the task item and leaves a later term in its outer item', () => {
    expect(carveToHtml('- * [ ] * :: t\n    : d\n   :: u\n')).toBe(
      '<ul>\n  <li>\n    <ul class="task-list">\n      <li><input type="checkbox" disabled> \n        <ul>\n          <li>\n            <dl>\n              <dt>t</dt>\n            </dl>\n          </li>\n        </ul>\n        : d\n      </li>\n    </ul>\n    <dl>\n      <dt>u</dt>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('keeps a separator one column beyond the task content column in the term', () => {
    expect(carveToHtml('- * [ ] * :: t\n     : d\n')).toContain('<dt>t\n: d</dt>')
  })

  it('uses the authored column under a quote prefix', () => {
    expect(carveToHtml('> - * [ ] * :: t\n>     : d\n')).toContain('          : d\n')
  })
})
