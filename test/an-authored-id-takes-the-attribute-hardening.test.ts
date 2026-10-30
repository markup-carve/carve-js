import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P9-054 has no exception for `id` (markup-carve/carve#4488).
describe('an authored id takes the attribute hardening', () => {
  it.each([
    ['{id="javascript:x"}\np\n', '<p id="">p</p>'],
    ['{id="Shell: b"}\np\n', '<p id="">p</p>'],
    ['*x*{id="data:x"}\n', '<p><strong id="">x</strong></p>'],
    ['{id="ok"}\np\n', '<p id="ok">p</p>'],
    ['{#ok}\np\n', '<p id="ok">p</p>'],
  ])('%j', (source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })

  it('leaves a generated heading id alone', () => {
    expect(carveToHtml('# Data: x\n', { sections: false })).toContain('id="Data-x"')
  })
})
