import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A brace line is held only by a code span or comment the paragraph's inline pairing holds open (carve#5740, option B).
describe('a brace line held by inline pairing', () => {
  it.each([
    ['closed comment', 'p {% a\n{lang=de}\nz %} y\n', '<p>p  y</p>'],
    ['literal brace group', 'a{title="`"}\n{k=v}\nb\n', '<p>a{title=“<code>"}\n{k=v}\nb</code></p>'],
    ['accepted inline attribute', '[a]{title="`"}\n{k=v}\nb\n', '<p><span title="`">a</span></p>\n<p k="v">b</p>'],
    ['emphasis host', '*a*{title="`"}\n{.x}\nb\n', '<p><strong title="`">a</strong></p>\n<p class="x">b</p>'],
    ['unclosed comment', '{%%%:fr}\ny\n{.x}\nz\n', '<p>{%%%:fr}\ny</p>\n<p class="x">z</p>'],
    ['comment closed on its line', 'p {% a %} {% b\n{.x}\nz\n', '<p>p  {% b</p>\n<p class="x">z</p>'],
    ['comment closer after a blank line', 'p {% a\n{.x}\nz\n\n%}\n', '<p>p {% a</p>\n<p class="x">z</p>\n<p>%}</p>'],
    ['quoted', '> [a]{title="`"}\n> {k=v}\n> b\n', '<blockquote>\n  <p><span title="`">a</span></p>\n  <p k="v">b</p>\n</blockquote>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
