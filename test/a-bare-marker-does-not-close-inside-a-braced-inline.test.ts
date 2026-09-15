import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectBuiltInputScansLinearly, expectScansLinearly, perfIt } from './helpers/scaling.js'

// E2a, markup-carve/carve#2027: a bare closer is hidden inside a code span or a
// braced inline, and nowhere else.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a bare marker does not close inside a braced inline', () => {
  it('leaves the strike unopened when its only closer is inside a forced span', () => {
    expect(html('~{/x~/}')).toBe('<p>~<em>x~</em></p>')
  })

  it('answers the clause example', () => {
    expect(html('~{/x/}{/y~/}')).toBe('<p>~<em>x</em><em>y~</em></p>')
  })

  it('closes after the span when a closer follows it', () => {
    expect(html('~{/a/}{/b~/}c~')).toBe('<p><s><em>a</em><em>b~</em>c</s></p>')
  })

  it('hides a critic insertion', () => {
    expect(html('~{+a~+}b~')).toBe('<p><s><ins>a~</ins>b</s></p>')
  })

  it('hides a critic substitution', () => {
    expect(html('~{~a~>b~~}c~')).toBe('<p><s><del>a</del><ins>b~</ins>c</s></p>')
  })

  it('hides a critic comment', () => {
    expect(html('~{#a~#}b~')).toBe('<p><s><span class="critic-comment">a~</span>b</s></p>')
  })

  it('hides a comment whose body holds an apostrophe', () => {
    expect(html("~{% it's~ %}b~")).toBe('<p><s>b</s></p>')
  })

  it('hides a forced span that spans a newline, which the parser builds as one', () => {
    expect(html('~{/a\nb~/}')).toBe('<p>~<em>a\nb~</em></p>')
  })

  it('does not hide a plain brace pair', () => {
    expect(html('~{y~}z~')).toBe('<p><s>{y</s>}z~</p>')
  })

  it('does not hide an attribute block', () => {
    expect(html('~x{.c~}y~')).toBe('<p><s>x{.c</s>}y~</p>')
  })

  it('does not hide a brace pair that opens like a critic comment and never closes as one', () => {
    expect(html('~a{#x~}b~')).toBe(
      '<p><s>a{<span class="tag"><strong>#x</strong></span></s>}b~</p>',
    )
  })

  it('still hides a code span, the exclusion that was already there', () => {
    expect(html('~`a~b`~')).toBe('<p><s><code>a~b</code></s></p>')
  })

  it('still closes inside a link label, which no clause hides', () => {
    expect(html('~[a~](b)')).toBe('<p><s>[a</s>](b)</p>')
  })
})

// E2a, markup-carve/carve#2046: a link or image destination, title included,
// and an autolink are opaque too. The LABEL still is not.
describe('a bare marker does not close inside a link destination or an autolink', () => {
  it('answers the clause example for a link', () => {
    expect(html('/see [x](http://a.b/c) now/')).toBe('<p><em>see <a href="http://a.b/c">x</a> now</em></p>')
  })

  it('answers the clause example for an autolink', () => {
    expect(html('/see <http://a.b/c> now/')).toBe(
      '<p><em>see <a href="http://a.b/c">http://a.b/c</a> now</em></p>',
    )
  })

  it('leaves the strike unopened when its only closer is inside a destination', () => {
    expect(html('~[a](b~) c')).toBe('<p>~<a href="b~">a</a> c</p>')
  })

  it('leaves it unopened when the closer is inside an autolink', () => {
    expect(html('~<http://x/a~>')).toBe('<p>~<a href="http://x/a~">http://x/a~</a></p>')
  })

  it('hides an image destination', () => {
    expect(html('~see ![a](b~) now~')).toBe('<p><s>see <img src="b~" alt="a"> now</s></p>')
  })

  it('hides a title, which the destination carries', () => {
    expect(html('~see [a](b "t~") now~')).toBe('<p><s>see <a href="b" title="t~">a</a> now</s></p>')
  })

  it('does not hide the attribute block after the destination', () => {
    expect(html('~[a](b){.c~} d~')).toBe('<p><s><a href="b">a</a>{.c</s>} d~</p>')
  })

  it('does not hide a tail whose destination holds whitespace, which is no link', () => {
    expect(html('~[a](b c~) d~')).toBe('<p><s>[a](b c</s>) d~</p>')
  })

  it('does not hide a footnote reference\'s tail', () => {
    expect(html('~[^n](b~) c~')).toBe('<p><s>[^n](b</s>) c~</p>')
  })

  it('does not hide a tail whose bracket is escaped', () => {
    expect(html('~\\[a](b~) c~')).toBe('<p><s>[a](b</s>) c~</p>')
  })

  it('does not hide a parenthesis run with no label in front of it', () => {
    expect(html('~a](b~) c')).toBe('<p><s>a](b</s>) c</p>')
  })
})

describe('the braced-inline exclusion stays linear', () => {
  const render = (input: string) => void carveToHtml(input)

  perfIt('over openers whose spans all share one far closer', () => {
    expectScansLinearly(render, '~{/a ', { suffix: '/}' })
  })

  perfIt('over nested brace runs that close at the end', () => {
    expectBuiltInputScansLinearly(render, (n) => '~{ '.repeat(n) + '}'.repeat(n), {
      label: 'nested braces',
    })
  })

  perfIt('over openers inside one plain brace group', () => {
    expectScansLinearly(render, '~a ', { prefix: '{ ', suffix: '}' })
  })

  perfIt('over bracket-parenthesis pairs that open no link', () => {
    expectBuiltInputScansLinearly(render, (n) => '~x' + ']('.repeat(n) + ')', {
      label: 'label-less tails',
    })
  })

  perfIt('over destinations nested inside one another', () => {
    expectBuiltInputScansLinearly(render, (n) => '~' + '[x]('.repeat(n) + 'u' + ')'.repeat(n) + '~', {
      label: 'nested destinations',
    })
  })
})
