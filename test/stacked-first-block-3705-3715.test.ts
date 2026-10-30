import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

it('leaves a column-zero empty quote outside a stacked first-block plus', () => {
  expect(renderHtml(parse('- > +\n>'))).toBe('<ul>\n  <li>\n    <blockquote><p>+</p></blockquote>\n  </li>\n</ul>\n<blockquote>\n\n</blockquote>')
  const list = parse('- > +\n>', { positions: true }).children[0]
  if (list?.type !== 'list') throw new Error('expected list')
  const outer = list.items[0]?.children[0]
  if (outer?.type !== 'block_quote') throw new Error('expected outer quote')
  expect(outer.pos).toMatchObject({ startLine: 1, startColumn: 3, endLine: 1 })
  expect(outer.children[0]?.pos).toMatchObject({ startLine: 1, startColumn: 5, endLine: 1 })
})

it('folds a column-two follower into the plus of three stacked items', () => {
  expect(renderHtml(parse('- - - +\n  b'))).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>+\nb</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>')
})
