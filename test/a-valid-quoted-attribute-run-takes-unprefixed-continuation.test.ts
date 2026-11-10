import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['quote', '> {.x\n   .y}\nplain\n', '<blockquote>\n\n</blockquote>\n<p>plain</p>'],
  ['nested quote', '> > {.x\n     .y}\nplain\n', '<blockquote>\n  <blockquote>\n\n  </blockquote>\n</blockquote>\n<p>plain</p>'],
  ['quote in an item', '- > {.x\n     .y}\nplain\n', '<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>plain</p>'],
  ['several continuations', '> {.x\n   .y\n   .z}\nplain\n', '<blockquote>\n\n</blockquote>\n<p>plain</p>'],
])('closes a %s attribute run with deeper unprefixed lines (carve#5765)', (_name, source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})

it('keeps a shallow unprefixed continuation as paragraph text', () => {
  expect(carveToHtml('> {.x\n .y}\nplain\n')).toBe('<blockquote><p>{.x\n.y}\nplain</p></blockquote>')
})

it('leaves a heading outside the quote when the attribute run never closes', () => {
  expect(carveToHtml('> {.x\n   # h\nplain\n')).toBe('<blockquote><p>{.x</p></blockquote>\n<section id="h">\n  <h1>h</h1>\n  <p>plain</p>\n</section>')
})
