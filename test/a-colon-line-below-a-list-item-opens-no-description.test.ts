import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const normalize = (html: string) => html.trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it.each([
  ['- x\n: e\n :: t\n : zq\n', '<ul>\n<li>x\n: e\n:: t\n: zq</li>\n</ul>'],
  ['1. x\n: e\n  :: t\n  : zq\n', '<ol>\n<li>x\n: e\n:: t\n: zq</li>\n</ol>'],
  ['- [ ] x\n: e\n :: t\n : zq\n', '<ul class="task-list">\n<li><input type="checkbox" disabled aria-label="x : e :: t : zq"> x\n: e\n:: t\n: zq</li>\n</ul>'],
  ['- x\n  - y\n: e\n :: t\n : zq\n', '<ul>\n<li>x\n<ul>\n<li>y\n: e\n:: t\n: zq</li>\n</ul>\n</li>\n</ul>'],
  ['> - x\n> : e\n>  :: t\n>  : zq\n', '<blockquote>\n<ul>\n<li>x\n: e\n:: t\n: zq</li>\n</ul>\n</blockquote>'],
])('keeps lines below %j as the item paragraph', (source, expected) => {
  expect(normalize(carveToHtml(source))).toBe(expected)
})

it('still opens a term at the item content column after a lazy colon line', () => {
  expect(normalize(carveToHtml('- x\n: e\n  :: t\n  : zq\n'))).toBe(
    '<ul>\n<li>x\n: e\n<dl>\n<dt>t</dt>\n<dd>zq</dd>\n</dl>\n</li>\n</ul>',
  )
})

it('drops the lazy indent of a quoted term continuation', () => {
  expect(carveToHtml('> - x\n>     :: t\n>  zq\n')).toContain('<dt>t\nzq</dt>')
  expect(carveToHtml('> - x\n> : e\n>     :: t\n>  : zq\n')).toContain('<dt>t\n: zq</dt>')
})
