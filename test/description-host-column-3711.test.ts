import { expect, it } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

it('keeps a marker-line term at its item content column across a plus', () => {
  expect(renderHtml(parse('- :: t\n+\n: d'))).toBe('<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n    </dl>\n    : d\n  </li>\n</ul>')
})
