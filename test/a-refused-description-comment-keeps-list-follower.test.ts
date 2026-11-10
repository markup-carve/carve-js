import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a list marker after a refused description comment run in its paragraph (carve#5813)', () => {
  expect(carveToHtml(':: t\n: {% a\n%}\n- next\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{% a\n%}\n- next</dd>\n</dl>')
})

it('keeps a marker after a refused run in a description nested in an item', () => {
  expect(carveToHtml('- :: outer\n  : lead\n  :: t\n  : {% a\n   %}\n  - next\n').trim()).toBe(
    '<ul>\n  <li>\n    <dl>\n      <dt>outer</dt>\n      <dd>lead</dd>\n      <dt>t</dt>\n      <dd>{% a\n%}\n- next</dd>\n    </dl>\n  </li>\n</ul>')
})

it('leaves a marker outside a description when a nested item owns the refused run', () => {
  expect(carveToHtml(':: t\n: - {% a\n  %}\n- next\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <ul>\n      <li>{% a\n%}</li>\n    </ul>\n  </dd>\n</dl>\n<ul>\n  <li>next</li>\n</ul>')
})

it('leaves a marker outside a description when a quote owns the refused run', () => {
  expect(carveToHtml(':: t\n: > {% a\n%}\n- next\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote><p>{% a\n%}</p></blockquote>\n  </dd>\n</dl>\n<ul>\n  <li>next</li>\n</ul>')
})

it('leaves a marker outside a description after an invalid brace sequence', () => {
  expect(carveToHtml(':: t\n: {#x\n%}\n- next\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>{<span class="tag"><strong>#x</strong></span>\n%}</dd>\n</dl>\n<ul>\n  <li>next</li>\n</ul>')
})

it('leaves a marker outside a description when a marker-line quote owns the refused run', () => {
  expect(carveToHtml(':: t\n: > {.x\n  }\n- n\n').trim()).toBe(
    '<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote><p>{.x\n}</p></blockquote>\n  </dd>\n</dl>\n<ul>\n  <li>n</li>\n</ul>')
})

it('does not reopen a comment that already closed on its marker line', () => {
  expect(carveToHtml('- :: t\n  : {% a %}\n%}\n  - n\n').trim()).toBe(
    '<ul>\n  <li>\n    <dl>\n      <dt>t</dt>\n      <dd>\n%}</dd>\n    </dl>\n    <ul>\n      <li>n</li>\n    </ul>\n  </li>\n</ul>')
})
