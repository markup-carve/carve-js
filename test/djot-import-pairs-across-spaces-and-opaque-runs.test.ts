import { describe, expect, it } from 'vitest'
import { escapePlainCarveInlineSyntaxAround, HANDLED_DJOT } from '../src/carve-escape.js'
import { carveToHtml, djotToCarve } from '../src/index.js'

const html = (carve: string) => carveToHtml(carve).trim()

// Djot has no slash emphasis and no bare highlight, so each source is text.
describe('a Djot pair that spans a space or an opaque run stays literal', () => {
  it.each([
    ['/a b/', '\\/a b/', '<p>/a b/</p>'],
    ['/a /b/', '\\/a \\/b/', '<p>/a /b/</p>'],
    ['=a b=', '\\=a b=', '<p>=a b=</p>'],
    ['/a `c` b/', '\\/a `c` b/', '<p>/a <code>c</code> b/</p>'],
    ['/a [l](u) b/', '\\/a [l](u) b/', '<p>/a <a href="u">l</a> b/</p>'],
    ['/a\nb c/', '\\/a\nb c/', '<p>/a\nb c/</p>'],
    ['/a _e_ b/', '\\/a /e/ b/', '<p>/a <em>e</em> b/</p>'],
  ])('writes %j as %j', (djot, carve, rendered) => {
    expect(djotToCarve(djot + '\n')).toBe(carve + '\n')
    expect(html(carve)).toBe(rendered)
  })

  // Near misses: no pair exists, so an escape would be a character too many.
  it.each([
    ['see /usr/local/bin and x', '<p>see /usr/local/bin and x</p>'],
    ['/a b', '<p>/a b</p>'],
    ['/a\n\nb/', '<p>/a</p>\n<p>b/</p>'],
    ['/a `b/` c', '<p>/a <code>b/</code> c</p>'],
    ['a `/x` b/ c', '<p>a <code>/x</code> b/ c</p>'],
    ['=a b', '<p>=a b</p>'],
    ['=a\n\nb=', '<p>=a</p>\n<p>b=</p>'],
  ])('leaves %j bare', (djot, rendered) => {
    expect(djotToCarve(djot + '\n')).toBe(djot + '\n')
    expect(html(djot)).toBe(rendered)
  })
})

describe('escaping around opaque runs', () => {
  it('puts opaque characters back in order and escapes nothing inside them', () => {
    const source = '/a `/x/` =b= b/'
    const opaque = (at: number) => at >= 3 && at <= 7 && source[at] !== ' '
    expect(escapePlainCarveInlineSyntaxAround(source, opaque, HANDLED_DJOT)).toBe('\\/a `/x/` \\=b= b/')
  })

  it('picks a stand-in the source does not hold', () => {
    const source = '/a x b/'
    expect(escapePlainCarveInlineSyntaxAround(source, at => at === 5, HANDLED_DJOT)).toBe('\\/a x b/')
  })
})
