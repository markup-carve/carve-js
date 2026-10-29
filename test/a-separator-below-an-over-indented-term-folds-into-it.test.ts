import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it.each([
  ['> - x\n> x\n>    :: u\n>   : zq\n', '<blockquote>\n<ul>\n<li>x\nx\n<dl>\n<dt>u</dt>\n<dd>zq</dd>\n</dl>\n</li>\n</ul>\n</blockquote>'],
  ['- x\nx\n   :: u\n  : zq\n', '<ul>\n<li>x\nx\n<dl>\n<dt>u</dt>\n<dd>zq</dd>\n</dl>\n</li>\n</ul>'],
  ['- x\n   :: u\n  : zq\n', '<ul>\n<li>x\n<dl>\n<dt>u</dt>\n<dd>zq</dd>\n</dl>\n</li>\n</ul>'],
  ['- a\n   :: m\n  : l\n  : k\n', '<ul>\n<li>a\n<dl>\n<dt>m</dt>\n<dd>l</dd>\n<dd>k</dd>\n</dl>\n</li>\n</ul>'],
])('folds the separator in %j into the term', (source, expected) => {
  expect(normalize(carveToHtml(source))).toBe(expected)
})

it('describes the term from its own column', () => {
  expect(normalize(carveToHtml('- x\nx\n   :: u\n   : zq\n'))).toBe(
    '<ul>\n<li>x\nx\n<dl>\n<dt>u</dt>\n<dd>zq</dd>\n</dl>\n</li>\n</ul>',
  )
})
