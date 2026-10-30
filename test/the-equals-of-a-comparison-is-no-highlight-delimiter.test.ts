import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The `=` of a comparison `!=`, `<=` or `>=` is part of the symbol and neither
// opens nor closes a bare highlight (PART 9 §9, markup-carve/carve#4131 and #4177).

const html = (source: string) => carveToHtml(source).trim()

describe('the = of a comparison', () => {
  it.each([
    ['<=', '=a <= b=', '<p><mark>a ≤ b</mark></p>'],
    ['>=', '=a >= b=', '<p><mark>a ≥ b</mark></p>'],
    ['!=', '=a != b=', '<p><mark>a ≠ b</mark></p>'],
    ['>= with no closer after it', '=a>= b', '<p>=a≥ b</p>'],
    ['!= at the end of the run', '=a !=', '<p>=a ≠</p>'],
    ['>= behind a hyphen run', '=a --->= b=', '<p><mark>a ---≥ b</mark></p>'],
    ['>= behind a bare =', '=a =>= b=', '<p><mark>a =≥ b</mark></p>'],
  ])('does not close a highlight in %s', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it.each([
    ['the = after !=', '=a !== b=', '<p><mark>a ≠</mark> b=</p>'],
    ['the first = of <==', '=a <== b=', '<p><mark>a &lt;</mark>= b=</p>'],
    ['an escaped <', '=a \\<= b=', '<p><mark>a &lt;</mark> b=</p>'],
  ])('leaves %s free to close', (_, source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('does not open a highlight', () => {
    expect(html('x !=y= z')).toBe('<p>x ≠y= z</p>')
  })

  it('reads a long run of comparisons in linear time', () => {
    const time = (n: number) => {
      const source = '=a ' + '<= b '.repeat(n) + '='
      const start = performance.now()
      carveToHtml(source)
      return performance.now() - start
    }
    time(2000)
    expect(time(32000)).toBeLessThan(Math.max(50, time(8000)) * 12)
  })
})
