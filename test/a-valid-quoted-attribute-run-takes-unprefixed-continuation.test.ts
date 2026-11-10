import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['quote', '> {.x\n   .y}\nplain\n', '<blockquote><p>{.x\n.y}\nplain</p></blockquote>'],
  ['nested quote', '> > {.x\n     .y}\nplain\n', '<blockquote>\n  <blockquote><p>{.x\n.y}\nplain</p></blockquote>\n</blockquote>'],
  ['quote in an item', '- > {.x\n     .y}\nplain\n', '<ul>\n  <li>\n    <blockquote><p>{.x\n.y}\nplain</p></blockquote>\n  </li>\n</ul>'],
  ['several continuations', '> {.x\n   .y\n   .z}\nplain\n', '<blockquote><p>{.x\n.y\n.z}\nplain</p></blockquote>'],
])('refuses a %s attribute run on deeper unprefixed lines, which are lazy (carve#5830)', (_name, source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})

it('keeps a shallow unprefixed continuation as paragraph text', () => {
  expect(carveToHtml('> {.x\n .y}\nplain\n')).toBe('<blockquote><p>{.x\n.y}\nplain</p></blockquote>')
})

it('leaves a heading outside the quote when the attribute run never closes', () => {
  expect(carveToHtml('> {.x\n   # h\nplain\n')).toBe('<blockquote><p>{.x</p></blockquote>\n<section id="h">\n  <h1>h</h1>\n  <p>plain</p>\n</section>')
})

it('does not let a later same-column quoted opener close an earlier run', () => {
  expect(carveToHtml('> {.x\n   .y\n> {.a\n   .b}\nplain\n')).toBe('<blockquote><p>{.x\n.y\n{.a\n.b}\nplain</p></blockquote>')
})
