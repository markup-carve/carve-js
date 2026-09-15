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
})
