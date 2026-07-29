import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToCarve } from '../src/index.js'

/**
 * A destination's parentheses balance, so a URL that carries one needs no
 * escape and no second spelling (carve issue 377). Djot and CommonMark both do
 * this; the cases below were checked against djot 0.3.2 and commonmark.js.
 */
const href = (src: string): string => {
  const m = /href="([^"]*)"/.exec(carveToHtml(src))
  if (m === null) throw new Error(`no link in: ${carveToHtml(src)}`)
  return m[1]!
}

describe('a link destination balances its parentheses', () => {
  it('keeps a parenthesized tail inside the URL', () => {
    expect(href('[x](https://en.wikipedia.org/wiki/Foo_(bar))')).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    )
  })

  it('nests to any depth', () => {
    expect(href('[x](a(b(c))d)')).toBe('a(b(c))d')
  })

  it('ends at a parenthesis with no opener left to pair with', () => {
    expect(carveToHtml('[x](e)f)')).toBe('<p><a href="e">x</a>f)</p>')
  })

  it('does not let an unclosed opener swallow the rest of the line', () => {
    // The run reaches end of line without balancing, so this is not a link.
    expect(carveToHtml('[t](url(more')).toBe('<p>[t](url(more</p>')
  })

  it('reads an escaped parenthesis as content, not as nesting', () => {
    expect(href('[x](http://a/b\\)c)')).toBe('http://a/b)c')
    expect(href('[x](http://a/b\\(c)')).toBe('http://a/b(c')
  })

  it('leaves a backslash alone in front of anything else', () => {
    expect(href('[x](a\\qb)')).toBe('a\\qb')
    expect(href('[x](a\\\\b)')).toBe('a\\b')
  })

  it('still ends the destination at whitespace, so a title can follow', () => {
    expect(carveToHtml('[x](/u "t")')).toBe('<p><a href="/u" title="t">x</a></p>')
  })
})

describe('the writer escapes only what the scan would misread', () => {
  const roundTrips = (src: string): void => {
    const out = carveToCarve(src)
    expect(carveToHtml(out)).toBe(carveToHtml(src))
    expect(carveToCarve(out)).toBe(out)
  }

  it('leaves a balanced pair bare', () => {
    const src = '[wiki][w]\n\n[w]:  https://en.wikipedia.org/wiki/Foo_(bar)\n'
    expect(carveToCarve(src)).toContain('(https://en.wikipedia.org/wiki/Foo_(bar))')
    roundTrips(src)
  })

  it('escapes an unbalanced parenthesis', () => {
    const src = '[x][w]\n\n[w]:  http://a/b)c\n'
    expect(carveToCarve(src)).toContain('(http://a/b\\)c)')
    roundTrips(src)
  })

  it('escapes an opener that never closes', () => {
    const src = '[x][w]\n\n[w]:  http://a/b(c\n'
    expect(carveToCarve(src)).toContain('(http://a/b\\(c)')
    roundTrips(src)
  })

  it('leaves an ordinary destination untouched', () => {
    expect(carveToCarve('[a](https://x/plain)\n')).toBe('[a](https://x/plain)\n')
  })
})
