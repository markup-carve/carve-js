import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('caret line below an open list paragraph', () => {
  it('continues the item as text', () => {
    expect(carveToHtml('- a\n^ caption\n')).toBe('<ul>\n  <li>a\n^ caption</li>\n</ul>')
  })

  it('leaves a heading as a separate block', () => {
    expect(carveToHtml('- a\n# H\n')).toBe('<ul>\n  <li>a</li>\n</ul>\n<section id="H">\n  <h1>H</h1>\n</section>')
  })
})

it('continues a quote paragraph inside a list', () => {
  expect(carveToHtml('- > a\n^ cap\n')).toBe('<ul>\n  <li>\n    <blockquote><p>a\n^ cap</p></blockquote>\n  </li>\n</ul>')
})
