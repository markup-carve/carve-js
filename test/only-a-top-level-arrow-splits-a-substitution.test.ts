import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `{~ ~}` pair is a substitution only when it holds a top-level `~>`. The
// search skips a code span (and the math and inline literal built on one), a
// comment and an escape; a pair with no such arrow is a forced strike
// (markup-carve/carve#2083). Both halves are inline content (carve-js#1827).

const html = (source: string) => carveToHtml(source).trim()

describe('a substitution arrow', () => {
  it.each([
    ['inside an unclosed code span', '{~`a~>b~}', '<p><s><code>a~&gt;b</code></s></p>'],
    ['inside a closed code span', '{~a `x~>y` b~}', '<p><s>a <code>x~&gt;y</code> b</s></p>'],
    ['escaped', '{~a\\~>b~}', '<p><s>a~&gt;b</s></p>'],
  ])('does not split the pair %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it.each([
    ['after a math span that holds one', '{~$`a~>b`~>c~}', '<p><del><span class="math inline" role="math">\\(a~&gt;b\\)</span></del><ins>c</ins></p>'],
    ['after an inline literal that holds one', '{~!`a~>b`~>c~}', '<p><del>a~&gt;b</del><ins>c</ins></p>'],
    ['after an editorial comment that holds one', '{~a{# ~> #}b~>c~}', '<p><del>a<span class="critic-comment"> ~&gt; </span>b</del><ins>c</ins></p>'],
    ['after a delimited comment that holds one', '{~a{% ~> %}b~>c~}', '<p><del>ab</del><ins>c</ins></p>'],
    ['with a brace in a half', '{~a}~>b~}', '<p><del>a}</del><ins>b</ins></p>'],
    ['with an empty old half', '{~~>b~}', '<p><del></del><ins>b</ins></p>'],
  ])('splits the pair at the top-level one %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('is opaque to an open strike when it splits the pair', () => {
    expect(html('~a {~b~>c~} d~')).toBe('<p><s>a <del>b</del><ins>c</ins> d</s></p>')
  })
})
