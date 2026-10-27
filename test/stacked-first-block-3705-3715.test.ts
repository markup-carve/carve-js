import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

it('keeps a column-zero empty quote under a stacked first-block continuation', () => {
  expect(renderHtml(parse('- > +\n>'))).toBe('<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>')
  const list = parse('- > +\n>', { positions: true }).children[0]
  if (list?.type !== 'list') throw new Error('expected list')
  const outer = list.items[0]?.children[0]
  if (outer?.type !== 'block_quote') throw new Error('expected outer quote')
  expect(outer.pos).toMatchObject({ startLine: 1, startColumn: 3, endLine: 2 })
  expect(outer.children[0]?.pos).toMatchObject({ startLine: 2, startColumn: 1, endLine: 2 })
})

it('returns a column-two follower to the outer of three stacked items', () => {
  expect(renderHtml(parse('- - - +\n  b'))).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n    b\n  </li>\n</ul>')
})
