import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const ruledHtml = new Map<string, string>([
  [
    "::: box\n- q\n+\nx\n+\n:::\n",
    "<div class=\"box\">\n  <ul>\n    <li>q\n      x\n    </li>\n  </ul>\n</div>"
  ],
  [
    "::: box\n* q\n+\nx\n+\n:::\n",
    "<div class=\"box\">\n  <ul>\n    <li>q\n      x\n    </li>\n  </ul>\n</div>"
  ],
  [
    "::: box\n1. q\n+\nx\n+\n:::\n",
    "<div class=\"box\">\n  <ol>\n    <li>q\n      x\n    </li>\n  </ol>\n</div>"
  ],
  [
    ":: t\n: - +\n  - z\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n      <li>z</li>\n    </ul>\n  </dd>\n</dl>"
  ],
  [
    ":: t\n: * +\n  * z\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li></li>\n      <li>z</li>\n    </ul>\n  </dd>\n</dl>"
  ],
  [
    ":: t\n: 1. +\n  1. z\n",
    "<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li></li>\n      <li>z</li>\n    </ol>\n  </dd>\n</dl>"
  ],
  [
    "- +\n  - z\n",
    "<ul>\n  <li>\n    <ul>\n      <li>z</li>\n    </ul>\n  </li>\n</ul>"
  ]
])

describe('refused continuation and first-block ownership', () => {
  it.each([
    '::: box\n- q\n+\nx\n+\n:::\n',
    '::: box\n* q\n+\nx\n+\n:::\n',
    '::: box\n1. q\n+\nx\n+\n:::\n',
  ])('keeps a trailing refused marker in its open attached paragraph', source => {
    const html = carveToHtml(source)
    expect(html).toBe(ruledHtml.get(source))
    expect(html).not.toContain('<p>+</p>')
  })

  it.each(['- ', '* ', '1. '])('keeps a sibling after a refused description first block (%s)', marker => {
    const html = carveToHtml(`:: t\n: ${marker}+\n  ${marker}z\n`)
    expect(html).toBe(ruledHtml.get(`:: t\n: ${marker}+\n  ${marker}z\n`))
    expect(html).not.toContain('<li>\n        <ul>')
  })

  it('keeps a genuine indented child under a first-block list item', () => {
    const html = carveToHtml('- +\n  - z\n')
    expect(html).toBe(ruledHtml.get('- +\n  - z\n'))
  })
})
