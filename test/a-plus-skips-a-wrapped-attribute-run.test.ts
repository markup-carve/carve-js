import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// carve#5562: a wrapped attribute run between a first-block `+` and its list is one invisible
// line (PART 9 §17 L3, §15 A5), so the list stays in the host and takes the attributes.
it.each([
  [':: t\n: +\n{.x\n .y}\n- li\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul class="x y">\n      <li>li</li>\n    </ul>\n  </dd>\n</dl>'],
  [':: t\n: +\n{.x\n .y\n .z}\n1. li\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol class="x y z">\n      <li>li</li>\n    </ol>\n  </dd>\n</dl>'],
  [':: t\n: +\n{.x\n .y}\n%% c\n- li\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul class="x y">\n      <li>li</li>\n    </ul>\n  </dd>\n</dl>'],
  [':: t\n: +\n{.x}\n{.y\n .z}\n- li\n- l2\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul class="x y z">\n      <li>li</li>\n      <li>l2</li>\n    </ul>\n  </dd>\n</dl>'],
])('a description `+` reaches the list past a wrapped attribute run: %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})

it('a note `+` reaches the list past a wrapped attribute run', () => {
  expect(html('[^n]: +\n{.x\n .y}\n- li\n\nsee[^n]\n'))
    .toContain('<li id="fn1">\n      <ul class="x y">\n        <li>li</li>\n      </ul>')
})
