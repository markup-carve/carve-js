import { expect, test } from 'vitest'
import { markdownToCarve, carveToHtml } from '../src/index.js'

test('a spaced thematic break ends a preceding top-level list', () => {
  expect(carveToHtml(markdownToCarve('* Foo\n* * *\n* Bar\n')).trim()).toBe('<ul>\n  <li>Foo</li>\n</ul>\n<hr>\n<ul>\n  <li>Bar</li>\n</ul>')
})

test('a thematic break on an item line remains inside that item', () => {
  expect(carveToHtml(markdownToCarve('- Foo\n- * * *\n')).trim()).toBe('<ul>\n  <li>Foo</li>\n  <li>\n    <hr>\n  </li>\n</ul>')
})
