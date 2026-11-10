import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['- {% a\n   {k=v}\nz %} y\n', '<ul>\n  <li>{% a</li>\n</ul>\n<p>z %} y</p>'],
  ['-   {% a\n    {k=v}\n  z %} y\n', '<ul>\n  <li>{% a</li>\n</ul>\n<p>z %} y</p>'],
])('keeps a refused comment run and its lazy closer in the item (carve#5806): %j', (source, html) => {
  expect(carveToHtml(source)).toBe(html)
})

it.each([
  ['- > {% a\n  > # h\nz %} y\n', '<ul>\n  <li>\n    <blockquote>\n      <p>{% a</p>\n      <h1 id="h">h</h1>\n    </blockquote>\n  </li>\n</ul>\n<p>z %} y</p>'],
  ['- {% a\n  > # h\nz %} y\n', '<ul>\n  <li>{% a\n    <blockquote>\n      <h1 id="h">h</h1>\n    </blockquote>\n  </li>\n</ul>\n<p>z %} y</p>'],
])('ends item comment ownership when a quote block interrupts its paragraph: %j', (source, html) => {
  expect(carveToHtml(source)).toBe(html)
})

it('keeps the brace-shaped middle line in a description when the closer leaves it', () => {
  expect(carveToHtml(':: t\n:   {% a\n     {k=v}\nz %} y\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{% a</dd>\n</dl>\n<p>z %} y</p>',
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
    '<dl>\n  <dt>t</dt>\n  <dd>{% a</dd>\n  <dd>next\nz %} y</dd>\n</dl>',
  )
  expect(carveToHtml(':: t\n:   {% a\n     {k=v}\n: next\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{% a</dd>\n  <dd>next</dd>\n</dl>',
  )
})

it('keeps a heading between a description comment opener and a later shallow closer as a block', () => {
  expect(carveToHtml(':: t\n:   {% a\n     # h\nz %} y\n')).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>{% a</p>\n    <h1 id="h">h</h1>\n  </dd>\n</dl>\n<p>z %} y</p>',
  )
})

it.each([
  ['# h %} y', '<section id="h-y">\n  <h1>h %} y</h1>\n</section>'],
  ['> q %} y', '<blockquote><p>q %} y</p></blockquote>'],
  [':: next %} y', '<dl>\n  <dt>next %} y</dt>\n</dl>'],
])('lets a block opener leave the item even when it contains a comment closer: %s', (line, after) => {
  expect(carveToHtml(`- {% a\n   {k=v}\n${line}\n`)).toBe(
    `<ul>\n  <li>{% a</li>\n</ul>\n${after}`,
  )
})
