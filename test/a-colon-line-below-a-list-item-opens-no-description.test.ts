import { expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const normalize = (html: string) => html.trim().split('\n').map(line => line.trim()).filter(Boolean).join('\n')

it.each([
  ['- x\n: e\n :: t\n : zq\n', '<ul>\n<li>x\n: e</li>\n</ul>\n<dl>\n<dt>t</dt>\n<dd>zq</dd>\n</dl>'],
  ['1. x\n: e\n  :: t\n  : zq\n', '<ol>\n<li>x\n: e</li>\n</ol>\n<dl>\n<dt>t</dt>\n<dd>zq</dd>\n</dl>'],
  ['- [ ] x\n: e\n :: t\n : zq\n', '<ul class="task-list">\n<li><input type="checkbox" disabled aria-label="x : e"> x\n: e</li>\n</ul>\n<dl>\n<dt>t</dt>\n<dd>zq</dd>\n</dl>'],
  ['- x\n  - y\n: e\n :: t\n : zq\n', '<ul>\n<li>x\n<ul>\n<li>y\n: e</li>\n</ul>\n</li>\n</ul>\n<dl>\n<dt>t</dt>\n<dd>zq</dd>\n</dl>'],
  ['> - x\n> : e\n>  :: t\n>  : zq\n', '<blockquote>\n<ul>\n<li>x\n: e</li>\n</ul>\n<dl>\n<dt>t</dt>\n<dd>zq</dd>\n</dl>\n</blockquote>'],
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

it('anchors the stripped continuation at its text', () => {
  const source = '> - x\n>     :: t\n>  zq\n'
  const texts: { value: string; pos?: { startOffset?: number; endOffset?: number } }[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (record.type === 'text') texts.push(record as never)
    for (const [key, value] of Object.entries(record)) if (key !== 'pos') walk(value)
  }
  walk(parse(source))
  const zq = texts.find(text => text.value === 'zq')!
  expect(source.slice(zq.pos!.startOffset, zq.pos!.endOffset)).toBe('zq')
})
