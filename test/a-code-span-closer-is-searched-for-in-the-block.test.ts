import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A backtick run closes on an equal-length run anywhere later in the BLOCK, so
// a forced or editorial closer inside the span is code (markup-carve/carve#2079).
// A run with no closer at all still ends at the pair's closer
// (markup-carve/carve#2056), which keeps the pair.

const html = (source: string) => carveToHtml(source).trim()

describe('a code span opened inside a braced pair', () => {
  it.each([
    ['a forced emphasis whose closer the span holds', 'x{*`a*} and `b`', '<p>x{*<code>a*} and </code>b<code></code></p>'],
    ['a forced emphasis that closes after the span', '{*x`a*}`*}', '<p><strong>x<code>a*}</code></strong></p>'],
    ['an insertion whose closer the span holds', 'x{+`a+} and `b`', '<p>x{+<code>a+} and </code>b<code></code></p>'],
    ['an insertion that closes after the span', '{+x`a+}`+}', '<p><ins>x<code>a+}</code></ins></p>'],
  ])('reads %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it.each([
    ['an unclosed run ends at the pair closer', '{~` ~}', '<p><s><code></code></s></p>'],
    ['a closed run inside the pair', '{*a`b`c*}', '<p><strong>a<code>b</code>c</strong></p>'],
    ['a deletion with no span', '{-y-}', '<p><del>y</del></p>'],
    ['an empty pair is literal', '{**}', '<p>{**}</p>'],
    ['a braced hyphen pair is still an en dash', 'a {--}(p) b, x{--}y', '<p>a –(p) b, x–y</p>'],
    ['an escaped closer closing the pair', '{*a\\*}b*}', '<p><strong>a<br>\n</strong>b*}</p>'],
    ['an escaped backtick opening no span', '{*a\\`b*}', '<p><strong>a`b</strong></p>'],
    ['an escaped backtick where a later run could close one', '{+\\`a\\*}{*\\`*}\\`', '<p>{+`a*}<strong>`</strong>`</p>'],
  ])('keeps %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })
})
