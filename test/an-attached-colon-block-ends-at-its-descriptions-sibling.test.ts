import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// No closer further down is looked for (CARVE-P9-084, carve#4798).
describe('a colon block a + attaches to a description', () => {
  const empty = '<dl>\n  <dt>t</dt>\n  <dd>\n    <div>\n\n    </div>\n  </dd>\n  <dd>b</dd>\n</dl>'
  it.each([
    [':: t\n: +\n:::\n: b\n:::\n', `${empty}\n<div>\n\n</div>`],
    [':: t\n: +\n:::\n : b\n', empty],
    [':: t\n: a\n+\n:::\n: b\n:::\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>a</p>\n    <div>\n\n    </div>\n  </dd>\n  <dd>b</dd>\n</dl>\n<div>\n\n</div>'],
    [':: t\n: +\n:::\n:: u\n: v\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <div>\n\n    </div>\n  </dd>\n  <dt>u</dt>\n  <dd>v</dd>\n</dl>'],
    [':: t\n: +\n{.k}\n:::\n : b\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <div class="k">\n\n    </div>\n  </dd>\n  <dd>b</dd>\n</dl>'],
    [':: t\n: +\n:::\n: +\nz\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <div>\n\n    </div>\n  </dd>\n  <dd>z</dd>\n</dl>'],
  ])('ends at the sibling in %j', (src, want) => {
    expect(carveToHtml(src)).toBe(want)
  })
})
