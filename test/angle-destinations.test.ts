import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/**
 * A destination written `<...>` can carry characters a bare run cannot.
 *
 * A bare destination stops at the first `)` or whitespace - which is what it is
 * for, and corpus 107 pins it - so a URL containing a parenthesis could not be
 * expressed at all. Formatting one truncated the href and leaked the rest into
 * the text, in all three engines (carve#377).
 */
describe('angle-bracket destinations', () => {
  const href = (src: string) =>
    (parse(src).children[0] as any).children.find((n: any) => n.href !== undefined)?.href

  it('carries a parenthesis', () => {
    expect(href('[a](<https://x/Foo_(bar)>)\n')).toBe('https://x/Foo_(bar)')
  })

  it('carries a space', () => {
    expect(href('[a](<https://x/a b>)\n')).toBe('https://x/a b')
  })

  it('leaves a bare destination alone', () => {
    expect(href('[a](https://x/plain)\n')).toBe('https://x/plain')
  })

  it('does not change where a bare destination stops', () => {
    // corpus 107 pins this: the run ends at the first `(`.
    expect(href('[a](http://a/b(c))\n')).toBe('http://a/b(c')
  })

  it('works for an image source', () => {
    const img = (parse('![i](<img (1).png>)\n').children[0] as any).children[0]
    expect(img.src).toBe('img (1).png')
  })

  describe('the writer reaches for it only when it has to', () => {
    it('emits the angle form for a URL containing a parenthesis', () => {
      const src = '[wiki][w]\n\n[w]:  https://en.wikipedia.org/wiki/Foo_(bar)\n'
      const out = carveToCarve(src)
      expect(out).toContain('(<https://en.wikipedia.org/wiki/Foo_(bar)>)')
      expect(carveToHtml(out)).toBe(carveToHtml(src))
      expect(carveToCarve(out)).toBe(out)
    })

    it('leaves an ordinary URL bare', () => {
      expect(carveToCarve('[a](https://x/plain)\n')).toBe('[a](https://x/plain)\n')
    })
  })
})
