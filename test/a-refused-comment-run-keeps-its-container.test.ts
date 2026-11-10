import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['- {% a\n   {k=v}\nz %} y\n', '<ul>\n  <li>{% a\n{k=v}\nz %} y</li>\n</ul>'],
  ['-   {% a\n    {k=v}\n  z %} y\n', '<ul>\n  <li>{% a\n{k=v}\nz %} y</li>\n</ul>'],
])('keeps a refused comment run and its lazy closer in the item (carve#5806): %j', (source, html) => {
  expect(carveToHtml(source)).toBe(html)
})

it('keeps the brace-shaped middle line in a description when the closer leaves it', () => {
  expect(carveToHtml(':: t\n:   {% a\n     {k=v}\nz %} y\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{% a\n{k=v}</dd>\n</dl>\n<p>z %} y</p>',
  )
})

it('still hides a valid item comment run with a brace-shaped middle line', () => {
  expect(carveToHtml('- {% a\n   {k=v}\n   z %} y\n')).toBe('<ul>\n  <li> y</li>\n</ul>')
})

it('still hides a valid description comment run with a brace-shaped middle line', () => {
  expect(carveToHtml(':: t\n:   {% a\n     {k=v}\n     z %} y\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd> y</dd>\n</dl>',
  )
})

it('does not let a later description close an earlier comment run', () => {
  expect(carveToHtml(':: t\n:   {% a\n     {k=v}\n: next\nz %} y\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{% a\n{k=v}</dd>\n  <dd>next\nz %} y</dd>\n</dl>',
  )
  expect(carveToHtml(':: t\n:   {% a\n     {k=v}\n: next\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{% a\n{k=v}</dd>\n  <dd>next</dd>\n</dl>',
  )
})
