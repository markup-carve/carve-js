import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// E3 pushes no second level of one kind while one is open, and PART 9 §9 puts
// the forced `{X X}` form on the same stack as the bare one, so an opener of an
// open kind is content (markup-carve/carve#2078). The four rows are corpus
// section 471.

const html = (source: string) => carveToHtml(source).trim()

describe('a forced opener of an open kind', () => {
  it.each([
    ['a forced opener inside a forced span of its kind', 'a{*{*x*}*}b', '<p>a<strong>{*x</strong>*}b</p>'],
    ['a forced opener inside a bare span of its kind', '*a {*b*} c*', '<p><strong>a {*b</strong>} c*</p>'],
    ['a bare opener inside a forced span of its kind', '{*a *b* c*}', '<p><strong>a *b* c</strong></p>'],
    ['a forced opener of an open kind through another span', '{/a *b {/c/}*/}', '<p><em>a *b {/c</em>*/}</p>'],
    ['a forced pair the outer closer scan runs past', '*a {*b *} c*', '<p><strong>a {*b *} c</strong></p>'],
  ])('is literal for %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it.each([
    ['a span of another kind', '{*a /b/ c*}', '<p><strong>a <em>b</em> c</strong></p>'],
    ['a forced span of another kind', '*a {/b/} c*', '<p><strong>a <em>b</em> c</strong></p>'],
    ['a forced span with nothing open', 'a {*b*} c', '<p>a <strong>b</strong> c</p>'],
    ['a bold-italic, whose two kinds differ', '/*x*/', '<p><strong><em>x</em></strong></p>'],
    ['a substitution inside an open strike', '~a {~b~>c~} d~', '<p><s>a <del>b</del><ins>c</ins> d</s></p>'],
    ['a sibling span after a closed one of its kind', 'a {*b*} c {*d*} e', '<p>a <strong>b</strong> c <strong>d</strong> e</p>'],
  ])('leaves %s alone', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })
})
