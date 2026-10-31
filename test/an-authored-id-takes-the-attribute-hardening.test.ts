import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// `id` and the id slot are not URL sinks and are not probed (markup-carve/carve#4516).
describe('an authored id is not probed', () => {
  it.each([
    ['{id="javascript:x"}\np\n', '<p id="javascript:x">p</p>'],
    ['{id="Shell: b"}\np\n', '<p id="Shell: b">p</p>'],
    ['*x*{id="data:x"}\n', '<p><strong id="data:x">x</strong></p>'],
    ['{id="ok"}\np\n', '<p id="ok">p</p>'],
    ['{#ok}\np\n', '<p id="ok">p</p>'],
  ])('%j', (source, html) => {
    expect(carveToHtml(source).trim()).toBe(html)
  })

  it('leaves a generated heading id alone', () => {
    expect(carveToHtml('# Data: x\n', { sections: false })).toContain('id="Data-x"')
  })
})
