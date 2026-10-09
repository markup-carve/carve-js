import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

// PART 11 §8c writes the §8c constructs with no Markdown delimiter spelling as
// inline HTML. The importer read only a subset of those tags back, so a
// construct survived the trip as bytes and was lost as a construct
// (markup-carve/carve#2838).

/** Carve -> Markdown -> Carve, the trip the defect is measured on. */
const round = (carve: string): string => markdownToCarve(carveToMarkdown(carve))

describe('a §8c construct written as inline HTML', () => {
  it.each([
    ['underline', 'underline _u_ here\n', 'underline <u>u</u> here\n'],
    ['an editorial comment', 'comment {#note#} here\n', 'comment <span class="critic-comment">note</span> here\n'],
    ['an abbreviation', 'abbr [HTML]{abbr="Hyper Text"} here\n', 'abbr <abbr title="Hyper Text">HTML</abbr> here\n'],
  ])('comes back as %s rather than a raw span', (_name, carve, markdown) => {
    expect(carveToMarkdown(carve)).toBe(markdown)
    expect(round(carve)).toBe(carve)
    expect(markdownToCarve(markdown)).not.toContain('{=html}')
  })

  it('renders the element from a construct rather than from a raw span', () => {
    const carve = 'a _u_ {#note#} [HTML]{abbr="Hyper Text"} b\n'
    const imported = round(carve)
    expect(imported).not.toContain('{=html}')
    expect(carveToHtml(imported)).toBe(carveToHtml(carve))
  })
})

describe('an underline the bare form cannot spell', () => {
  it('is braced against a word character and around padding', () => {
    expect(markdownToCarve('a<u>x</u>b\n')).toBe('a{_x_}b\n')
    expect(markdownToCarve('a <u> y </u> b\n')).toBe('a {_ y _} b\n')
  })
})

describe('an attribute-bearing tag the construct cannot carry', () => {
  it('stays a raw span when the tag holds an attribute beside the one §8c writes', () => {
    expect(markdownToCarve('a <abbr title="T" class="x">HTML</abbr> b\n')).toContain('{=html}')
    expect(markdownToCarve('a <span class="critic-comment" id="k">note</span> b\n')).toContain('{=html}')
  })

  it('stays a raw span when the body would break out of the construct', () => {
    expect(markdownToCarve('a <abbr title="T">x [y] z</abbr> b\n')).toContain('{=html}')
    expect(markdownToCarve('a <span class="critic-comment">x {y} z</span> b\n')).toContain('{=html}')
  })

  it('leaves a span of another class alone', () => {
    expect(markdownToCarve('a <span class="other">note</span> b\n')).toContain('{=html}')
  })

  it('carries an entity in the title into the attribute', () => {
    expect(markdownToCarve('a <abbr title="A &amp; B">X</abbr> b\n')).toBe('a [X]{abbr="A & B"} b\n')
  })
})

// §8c spells a deletion `<del class="critic-delete">` and leaves a bare `<del>`
// meaning `strike`, so the two stop colliding on one tag
// (markup-carve/carve#2845).
describe('critic delete and critic substitution', () => {
  it('round-trips a deletion as a deletion', () => {
    expect(carveToMarkdown('delete {-del-} here\n')).toBe('delete <del class="critic-delete">del</del> here\n')
    expect(round('delete {-del-} here\n')).toBe('delete {-del-} here\n')
  })

  it('round-trips a substitution as a substitution', () => {
    expect(carveToMarkdown('substitute {~old~>new~} here\n'))
      .toBe('substitute <del class="critic-delete">old</del><ins>new</ins> here\n')
    expect(round('substitute {~old~>new~} here\n')).toBe('substitute {~old~>new~} here\n')
  })

  it('stays a raw span when the body would break out of the construct', () => {
    expect(markdownToCarve('a <del class="critic-delete">x {y} z</del> b\n')).toContain('{=html}')
    expect(markdownToCarve('a <del class="critic-delete">x ~> y</del><ins>z</ins> b\n')).toContain('{=html}')
  })
})

// The control the ruling turns on: §8c's own worked example is a `strike`
// written as a bare `<del>`, and a bare `<del>` must keep reading back as a
// `strike` rather than as the deletion (markup-carve/carve#2845).
describe('a bare del', () => {
  it('is still what a strike writes', () => {
    expect(carveToMarkdown('f {~ ~} g\n')).toBe('f <del> </del> g\n')
  })

  it('still imports as a strike and renders as one', () => {
    expect(markdownToCarve('a <del>x</del> b\n')).toBe('a ~x~ b\n')
    expect(carveToHtml(markdownToCarve('a <del>x</del> b\n'))).toContain('<s>x</s>')
  })
})

describe('the §8c constructs that already round-tripped', () => {
  it.each([
    ['highlight', 'highlight =hi= here\n'],
    ['subscript', 'subscript {,s,} here\n'],
    ['superscript', 'superscript {^s^} here\n'],
    ['a critic insert', 'insert {+ins+} here\n'],
    ['a deletion', 'delete {-del-} here\n'],
    ['a substitution', 'substitute {~old~>new~} here\n'],
  ])('still round-trips: %s', (_name, carve) => {
    expect(round(carve)).toBe(carve)
  })

  it('still reads a GFM strikethrough back as strike', () => {
    expect(markdownToCarve('strike ~~str~~ here\n')).toBe('strike ~str~ here\n')
    expect(round('strike ~str~ here\n')).toBe('strike ~str~ here\n')
  })
})
