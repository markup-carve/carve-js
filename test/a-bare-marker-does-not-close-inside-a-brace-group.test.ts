import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectBuiltInputScansLinearly, expectScansLinearly, perfIt } from './helpers/scaling.js'

// markup-carve/carve#2027: a bare closer is hidden inside a brace group, as
// inside a code span. carve-php is the reference.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a bare marker does not close inside a brace group', () => {
  it('leaves the strike unopened when its only closer is inside a braced inline', () => {
    expect(html('~{/x~/}')).toBe('<p>~<em>x~</em></p>')
  })

  it('does the same for a highlight', () => {
    expect(html('~{=x~=}')).toBe('<p>~<mark>x~</mark></p>')
  })

  it('does the same when text precedes the braced inline', () => {
    expect(html('~a{/y~/}')).toBe('<p>~a<em>y~</em></p>')
  })

  it('does the same for the second of two braced inlines', () => {
    expect(html('~{/x/}{/y~/}')).toBe('<p>~<em>x</em><em>y~</em></p>')
  })

  it('closes after the group when a closer follows it', () => {
    expect(html('~{/a/}{/b~/}c~')).toBe('<p><s><em>a</em><em>b~</em>c</s></p>')
  })

  it('hides a plain brace pair, which carve-php does too', () => {
    expect(html('~{y~}z~')).toBe('<p><s>{y~}z</s></p>')
  })

  it('balances nested braces', () => {
    expect(html('~{a{b}c~}d~')).toBe('<p><s>{a{b}c~}d</s></p>')
  })

  it('hides a brace inside a quoted run', () => {
    expect(html('~{a="}~"}z~')).toBe('<p><s>{a=“}~”}z</s></p>')
  })

  it('does not treat a group broken by a newline as opaque', () => {
    expect(html('~{a\nb~}')).toBe('<p><s>{a\nb</s>}</p>')
  })

  it('still closes inside a link label, which carve-php does not hide', () => {
    expect(html('~[a~](b)')).toBe('<p><s>[a</s>](b)</p>')
  })

  it('still opens an opener that sits inside a hidden plain group', () => {
    expect(html('~a {b ~c~}')).toBe('<p>~a {b <s>c</s>}</p>')
  })

  it('still skips a code span, the exclusion that was already there', () => {
    expect(html('~`a~b`~')).toBe('<p><s><code>a~b</code></s></p>')
  })
})

describe('the brace-group exclusion stays linear', () => {
  const render = (input: string) => void carveToHtml(input)

  perfIt('over openers whose groups all share one far closing brace', () => {
    expectScansLinearly(render, '~{a ', { suffix: '}' })
  })

  perfIt('over nested groups that close at the end', () => {
    expectBuiltInputScansLinearly(render, (n) => '~{ '.repeat(n) + '}'.repeat(n), {
      label: 'nested groups',
    })
  })

  perfIt('over openers inside one plain group', () => {
    expectScansLinearly(render, '~a ', { prefix: '{ ', suffix: '}' })
  })
})
