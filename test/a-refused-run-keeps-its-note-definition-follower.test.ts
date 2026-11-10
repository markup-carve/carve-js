import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['description', ':: t\n: {.x\n}\n[^m]: n\nz\n', '<dl>\n  <dt>t</dt>\n  <dd>{.x\n}\n[^m]: n\nz</dd>\n</dl>'],
  ['item', '- {.x\n}\n[^m]: n\nz\n', '<ul>\n  <li>{.x\n}\n[^m]: n\nz</li>\n</ul>'],
  ['description in an item', '- :: t\n  : {.x\n}\n[^m]: n\nz\n', '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>{.x\n}\n[^m]: n\nz</dd>\n    </dl>\n  </li>\n</ul>'],
])('keeps the note-definition follower of a refused brace run in %s (carve#5784)', (_name, source, expected) => {
  expect(carveToHtml(source)).toBe(expected)
})

it('still collects a note definition after a valid attribute run', () => {
  expect(carveToHtml('- {.x\n   .y}\n[^m]: n\nz\n')).toBe('<ul>\n  <li></li>\n</ul>')
})
