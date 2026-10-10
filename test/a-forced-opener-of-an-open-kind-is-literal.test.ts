import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

describe('a forced opener of an open kind', () => {
  it.each([
    ['a forced opener inside a forced span of its kind', 'a{*{*x*}*}b', '<p>a<strong><strong>x</strong></strong>b</p>'],
    ['a forced opener inside a bare span of its kind', '*a {*b*} c*', '<p><strong>a <strong>b</strong> c</strong></p>'],
    ['a bare opener inside a forced span of its kind', '{*a *b* c*}', '<p><strong>a *b* c</strong></p>'],
    ['a forced opener of an open kind through another span', '{/a *b {/c/}*/}', '<p><em>a <strong>b <em>c</em></strong></em></p>'],
    ['a forced pair the outer closer scan runs past', '*a {*b *} c*', '<p><strong>a <strong>b </strong> c</strong></p>'],
  ])('follows explicit and bare nesting rules for %s', (_, source, expected) => {
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
