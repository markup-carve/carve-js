import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// A brace run whose continuation is not past its `{` as written is paragraph text (CARVE-P2-035),
// even after the walk moved its opener to the note's body column, so the next line continues it.
it('a refused run under a note `+` keeps its paragraph open', () => {
  expect(html('r[^n]\n\n[^n]: +\n {.x\n .y}\np\n')).toContain('<li id="fn1">\n      <p>{.x\n.y}\np<a href="#fnref1"')
})

// A nested note after a wrapped run opens a paragraph its lazy line continues (CARVE-P9-067).
it('a nested note after a wrapped run takes its lazy line', () => {
  expect(html('r[^n]\n\n[^n]: +\n  {.x\n   .y}\n  [^m]: n\np\n')).not.toContain('<p>p</p>')
})

// A wrapped run after a kept note keeps its continuation's indentation in the item.
it('an item `+` reads a wrapped run after a kept note', () => {
  expect(html('- +\n  [^m]: n\n  {.x\n   .y}\n> q\n'))
    .toBe('<ul>\n  <li>\n    <blockquote class="x y"><p>q</p></blockquote>\n  </li>\n</ul>')
})
