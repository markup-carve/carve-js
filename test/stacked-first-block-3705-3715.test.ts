import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

it('leaves a column-zero empty quote outside a stacked first-block plus', () => {
  expect(renderHtml(parse('- > +\n>'))).toBe("<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<blockquote>\n\n</blockquote>")
  const list = parse('- > +\n>', { positions: true }).children[0]
  if (list?.type !== 'list') throw new Error('expected list')
  const outer = list.items[0]?.children[0]
  if (outer?.type !== 'block_quote') throw new Error('expected outer quote')
  expect(outer.pos).toMatchObject({ startLine: 1, startColumn: 3, endLine: 1 })
  // The consumed `+` leaves a stand-in comment the source never held, so it is unplaced (carve#5013, CARVE-P12-022).
  expect(outer.children[0]).toMatchObject({ type: 'comment', content: '' })
  expect(outer.children[0]?.pos).toBeUndefined()
})

it('folds a column-two follower into the plus of three stacked items', () => {
  expect(renderHtml(parse('- - - +\n  b'))).toBe("<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n    b\n  </li>\n</ul>")
})
