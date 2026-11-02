import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A failed `{` line is text and a later one still opens the block (carve#4089).
describe('a wrapped attribute block below a failed opener', () => {
  it.each([
    ['- a\n  {.c\n  {#i\n  }\npara\n', '<ul>\n  <li>a\n{.c</li>\n</ul>\n<p>para</p>'],
    [':: t\n: a\n  {.c\n  {#i\n  }\npara\n', '<dl>\n  <dt>t</dt>\n  <dd>a\n{.c</dd>\n</dl>\n<p>para</p>'],
    ['a\n{.c\n{#i\n}\npara\n', '<p>a\n{.c</p>\n<p id="i">para</p>'],
  ])('ends the host at the line after %j', (src, want) => {
    expect(carveToHtml(src)).toBe(want)
  })

  it('reads a brace in a quoted value as no closer', () => {
    expect(carveToHtml('- a\n  {#i k="}"\n  }\npara\n')).toBe('<ul>\n  <li>a</li>\n</ul>\n<p>para</p>')
  })
})
