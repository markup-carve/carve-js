import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each(['{.x}', '{.a}', '{#id}'])(
  'measures a later brace after marker-glued %s at its written column (carve#5788)',
  (glued) => {
    const source = `-${glued} {.x\n     .y}\n  # h\n`
    const attribute = glued === '{.x}' ? ' class="x"' : glued === '{.a}' ? ' class="a"' : ' id="id"'
    expect(carveToHtml(source)).toBe(`<ul>\n  <li${attribute}>{.x\n.y}\n# h</li>\n</ul>`)
  },
)

it('keeps a list-shaped follower in a refused later run as paragraph text', () => {
  expect(carveToHtml('-{.x} {.x\n     .y}\n  - next\n')).toBe(
    '<ul>\n  <li class="x">{.x\n.y}\n- next</li>\n</ul>',
  )
})

it('keeps a shallow follower in an ordered item after a refused later run', () => {
  expect(carveToHtml('1.{.x} {.x\n      .y}\n  word\n')).toBe(
    '<ol>\n  <li class="x">{.x\n.y}\nword</li>\n</ol>',
  )
})

it('lets a below-column heading end an ordered item after a refused later run', () => {
  expect(carveToHtml('1.{.x} {.x\n      .y}\n  # h\n')).toBe(
    '<ol>\n  <li class="x">{.x\n.y}</li>\n</ol>\n<section id="h">\n  <h1>h</h1>\n</section>',
  )
})
