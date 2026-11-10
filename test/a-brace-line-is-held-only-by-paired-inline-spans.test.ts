import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A brace line is held only by a code span or comment the paragraph's inline pairing holds open (carve#5740, option B).
describe('a brace line held by inline pairing', () => {
  it.each([
    ['closed comment', 'p {% a\n{lang=de}\nz %} y\n', '<p>p  y</p>'],
    ['literal brace group', 'a{title="`"}\n{k=v}\nb\n', '<p>a{title=“<code>"}\n{k=v}\nb</code></p>'],
    ['accepted inline attribute', '[a]{title="`"}\n{k=v}\nb\n', '<p><span title="`">a</span></p>\n<p k="v">b</p>'],
    ['stray bracket hosts nothing', '[a] b]{title="`"}\n{.x}\nz\n', '<p>[a] b]{title=“<code>"}\n{.x}\nz</code></p>'],
    ['glued attributes', '[a]{title="`"}{k="`"}\n{k=v}\nz\n', '<p><span title="`" k="`">a</span></p>\n<p k="v">z</p>'],
    ['intraword delimiter hosts nothing', 'a*b*{title="`"}\n{k=v}\nb\n', '<p>a*b*{title=“<code>"}\n{k=v}\nb</code></p>'],
    ['host across a soft break', '*a\nb*{title="`"}\n{k=v}\nz\n', '<p><strong title="`">a\nb</strong></p>\n<p k="v">z</p>'],
    ['escaped bracket hosts nothing', '\\[a]{title="`"}\n{k=v}\nb\n', '<p>[a]{title=“<code>"}\n{k=v}\nb</code></p>'],
    ['comment closer after an interrupting block', 'a {% x\n{.x}\n# h\nz %}\n', '<p>a {% x</p>\n<section id="h">\n  <h1 class="x">h</h1>\n  <p>z %}</p>\n</section>'],
    ['emphasis host', '*a*{title="`"}\n{.x}\nb\n', '<p><strong title="`">a</strong></p>\n<p class="x">b</p>'],
    ['unclosed comment', '{%%%:fr}\ny\n{.x}\nz\n', '<p>{%%%:fr}\ny</p>\n<p class="x">z</p>'],
    ['comment closed on its line', 'p {% a %} {% b\n{.x}\nz\n', '<p>p  {% b</p>\n<p class="x">z</p>'],
    ['comment closer after a blank line', 'p {% a\n{.x}\nz\n\n%}\n', '<p>p {% a</p>\n<p class="x">z</p>\n<p>%}</p>'],
    ['quoted', '> [a]{title="`"}\n> {k=v}\n> b\n', '<blockquote>\n  <p><span title="`">a</span></p>\n  <p k="v">b</p>\n</blockquote>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
