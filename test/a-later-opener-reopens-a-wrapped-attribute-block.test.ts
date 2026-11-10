import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A failed `{` line is text and a later one still opens the block (carve#4089).
// A closer at or below the later opener's column refuses it as well (carve#5080).
describe('a wrapped attribute block below a failed opener', () => {
  it.each([
    ['- a\n  {.c\n  {#i\n  }\npara\n', '<ul>\n  <li>a\n{.c\n{<span class="tag"><strong>#i</strong></span>\n}\npara</li>\n</ul>'],
    [':: t\n: a\n  {.c\n  {#i\n  }\npara\n', '<dl>\n  <dt>t</dt>\n  <dd>a\n{.c\n{<span class="tag"><strong>#i</strong></span>\n}\npara</dd>\n</dl>'],
    ['a\n{.c\n{#i\n}\npara\n', '<p>a\n{.c\n{<span class="tag"><strong>#i</strong></span>\n}\npara</p>'],
  ])('ends the host at the line after %j', (src, want) => {
    expect(carveToHtml(src)).toBe(want)
  })

  it('reads a brace in a quoted value as no closer', () => {
    expect(carveToHtml('- a\n  {#i k="}"\n  }\npara\n')).toBe('<ul>\n  <li>a\n{<span class="tag"><strong>#i</strong></span> k=“}”\n}\npara</li>\n</ul>')
  })
})
