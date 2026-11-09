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

// A wrapped run written past the marker column moves to it by its opener's shift, as a one-line run does.
it.each([
  [':: t\n: +\n  {.x\n   .y}\n- li\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul class="x y">\n      <li>li</li>\n    </ul>\n  </dd>\n</dl>'],
  [':: t\n: +\n   {.x\n    .y}\n> q\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote class="x y"><p>q</p></blockquote>\n  </dd>\n</dl>'],
])('an indented wrapped run still leads the attached block: %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})

it('a note `+` reaches the list past an indented wrapped run', () => {
  expect(html('[^n]: +\n  {.x\n   .y}\n- li\n\nsee[^n]\n'))
    .toContain('<li id="fn1">\n      <ul class="x y">\n        <li>li</li>\n      </ul>')
})

// An item `+` reads the block after the run and any note it keeps, whatever column the run was written at.
it.each([
  ['- +\n  {.x\n   .y}\n  [^m]: n\n> q\n', '<ul>\n  <li>\n    <blockquote class="x y"><p>q</p></blockquote>\n  </li>\n</ul>'],
  ['- +\n  {.x\n   .y}\n  [^m]: n\n: d\n', '<ul>\n  <li></li>\n</ul>'],
])('an item `+` past a wrapped run and a kept note: %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})
