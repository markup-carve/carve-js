import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { extractReferenceDefinitions } from '../src/markdown-empty-destination.js'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

// carve-js#3169: a quoted definition with a destination and a wrapped title.
const body = (carve: string) => carve.replace(/^(?:[> ]*\n)+/, '').trimEnd()

describe('a quoted Markdown definition with a destination whose title wraps', () => {
  it.each([
    ['quoted continuation', '> [r]: /u "a\n> b"\n>\n> [t][r]\n', '> [t](/u "a\n> b")'],
    ['lazy continuation', '> [r]: /u "a\nb"\n>\n> [t][r]\n', '> [t](/u "a\n> b")'],
    ['nested quote', '> > [r]: /u "a\n> > b"\n> >\n> > [t][r]\n', '> > [t](/u "a\n> > b")'],
    ['title on its own line', '> [r]: /u\n> "a\n> b"\n>\n> [t][r]\n', '> [t](/u "a\n> b")'],
    ['angle destination', "> [r]: <a b> 'a\n> b'\n>\n> [t][r]\n", "> [t](a%20b 'a\n> b')"],
  ])('becomes titled inline links: %s', (_name, source, expected) => {
    const carve = markdownToCarve(source)
    expect(body(carve)).toBe(expected)
    expect(carveToHtml(carve)).toContain(' title="a\nb">t</a>')
  })

  it('keeps a one-line title as a reference definition', () => {
    const carve = markdownToCarve('> [r]: /u "a b"\n>\n> [t][r]\n')
    expect(carve).toContain('> [t][r]')
    expect(carve).toContain('[r]: /u "a b"')
    expect(carveToHtml(carve)).toContain('<a href="/u" title="a b">t</a>')
  })
})

const extract = (source: string) => extractReferenceDefinitions(source.split('\n'), value => value, () => false)

for (const fragment of ['> [a]: /u', '> [a]: /u (x', '> [a]: /u "x', '> [a]: <> (x']) {
  perfIt(`a run of quoted definitions ${JSON.stringify(fragment)} scales`, () => {
    expectBuiltInputScansLinearly(source => { extract(source) },
      n => '> p\n>\n' + Array.from({ length: n }, () => fragment).join('\n'),
      { smallRepeats: 2_000, label: fragment })
  })
}
