import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([0, 2])('keeps a bullet at column %i in the description after a refused plus (carve#5608)', (column) => {
  const source = `:: t\n: +\n1. li\n+\n${' '.repeat(column)}- sib\n`
  expect(carveToHtml(source)).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <ul>\n      <li>sib</li>\n    </ul>\n  </dd>\n</dl>')
})

it('keeps a nested marker under the retained list', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n- sib\n  - tail\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n    <ul>\n      <li>sib\n        <ul>\n          <li>tail</li>\n        </ul>\n      </li>\n    </ul>\n  </dd>\n</dl>')
})

it('releases a marker between the document and description body columns', () => {
  expect(carveToHtml(':: t\n: +\n1. li\n+\n - sib\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ol>\n      <li>li</li>\n    </ol>\n  </dd>\n</dl>\n<ul>\n  <li>sib</li>\n</ul>')
})

