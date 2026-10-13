import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve, parse, renderHtml } from '../src/index.js'

// PART 9 §16: an authored `{#id}` on a footnote reference replaces `fnref{n}` /
// `fnref{n}-{k}`, and the note's backlink targets it.
const source = 'a [t[^1]{#z}][r] [^1]{#y} [^1]\n\n[r]: /u\n\n[^1]: n\n'

describe('an authored footnote reference id replaces the generated one', () => {
  for (const [name, render] of [
    ['carveToHtml', carveToHtml],
    ['renderHtml', (s: string) => renderHtml(parse(s))],
  ] as const) {
    it(name, () => {
      const html = render(source)
      expect(html.split('\n')[0]).toBe('<p>a <a href="/u">t<sup id="z">1</sup></a> <a id="y" href="#fn1" role="doc-noteref"><sup>1</sup></a> <a id="fnref1-3" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>')
      expect([...html.matchAll(/<a href="([^"]*)" role="doc-backlink"/g)].map((m) => m[1])).toEqual(['#z', '#y', '#fnref1-3'])
    })
  }

  it('escapes an authored id in the backlink', () => {
    const html = carveToHtml('a [^1]{id="q&r"}\n\n[^1]: n\n')
    expect(html).toContain('<a id="q&amp;r" href="#fn1" role="doc-noteref">')
    expect(html).toContain('<a href="#q&amp;r" role="doc-backlink"')
  })

  it('imports the references back with their authored ids, and leaves generated ones implicit', () => {
    const carve = htmlToCarve(carveToHtml(source)).value
    expect(carve).toBe('a [t[^1]{#z}](/u) [^1]{#y} [^1]\n\n[^1]: n\n')
    expect(carveToHtml(carve)).toBe(carveToHtml(source))
    expect(htmlToCarve(carveToHtml('a [^1] [^1]\n\n[^1]: n\n')).value).toBe('a [^1] [^1]\n\n[^1]: n\n')
  })

  it('reads only a fragment href as a backlink target', () => {
    const html = carveToHtml(source).replace('href="#z" role="doc-backlink"', 'href="/z" role="doc-backlink"')
    expect(htmlToCarve(html).value).not.toContain('[t[^1]]')
  })
})
