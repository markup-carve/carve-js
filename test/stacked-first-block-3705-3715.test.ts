import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

it('keeps a column-zero empty quote under a stacked first-block continuation', () => {
  expect(renderHtml(parse('- > +\n>'))).toBe('<ul>\n  <li>\n    <blockquote>\n      <blockquote>\n\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>')
})

it('returns a column-two follower to the outer of three stacked items', () => {
  expect(renderHtml(parse('- - - +\n  b'))).toBe('<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n    b\n  </li>\n</ul>')
})
