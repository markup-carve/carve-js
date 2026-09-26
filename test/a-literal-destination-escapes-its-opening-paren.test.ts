import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

describe('PART 11 §5 destination-opening parentheses', () => {
  it.each([
    ['[a](b)', '[a]\\(b)'],
    ['[a](b(xy)d)', '[a]\\(b(xy)d)'],
    ['[[a]](b)', '[[a]]\\(b)'],
    ['[a](b) and [c](d)', '[a]\\(b) and [c]\\(d)'],
    ['f(x) and (see above) and [a] (b) and [a](b c)', 'f(x) and (see above) and [a] (b) and [a](b c)'],
    ['](b) and [a]() and [a](b', '](b) and [a]() and [a](b'],
    ['[a](b(c d))', '[a](b(c d))'],
    ['[a](b) *x*', '[a]\\(b) \\*x*'],
    ['[a](b \"title\")', '[a](b \\\"title\\\")'],
    ['[a](b\\)c)', '[a]\\(b\\\\)c)'],
  ])('writes literal %s as %s', (literal, expected) => {
    const html = `<p>${literal}</p>`
    const out = htmlToCarve(html).value
    expect(out).toBe(`${expected}\n`)
    expect(carveToCarve(out)).toBe(out)
    expect(carveToHtml(out)).toBe(html)
  })

  it('keeps the brackets inside an attributed span', () => {
    const out = htmlToCarve('<p><span class="c">[a](u)</span></p>').value
    expect(out).toBe('[[a]\\(u)]{.c}\n')
    expect(carveToCarve(out)).toBe(out)
  })

  it('preserves real links', () => {
    expect(carveToCarve('[a](b)\n')).toBe('[a](b)\n')
  })
})
