import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * `link_title` is ONE literal space, and `image_title = link_title`.
 *
 * The production is spelled `space, ('"', ..., '"' | "'", ..., "'")` in
 * `resources/grammar.ebnf`, and PART 7 puts the slot after the first
 * non-whitespace character of the line, where a tab is not syntax at all.
 * markup-carve/carve#912 settles the cardinality the same way: exactly one
 * space, not a run.
 *
 * This engine spelled the slot `\s+` at two sites. JavaScript's `\s` is Unicode
 * White_Space PLUS U+FEFF MINUS U+0085, so SEVENTEEN characters besides the
 * space opened a title here (carve-js#809). carve-rs is the reference and
 * leaves every one of them literal.
 *
 * THE FAILURE IS NOT "A LINK WITHOUT A TITLE". The tail pattern matches nothing,
 * so no link is built at all: the bracket run stays literal text and the
 * character survives in the output. Asserting the absence of `title=` would pass
 * for a plain link too, which is why every row below asserts the fallback.
 */

const isLink = (html: string) => /<a |<img /.test(html)

describe('one literal space opens the title slot, and nothing else does', () => {
  // Every character JavaScript's `\s` admits. U+0085 is on the list from the
  // other side: it IS White_Space and is NOT in `\s`, so it was already
  // literal - a CONTROL, marked as such below.
  const separators: Array<[string, number]> = [
    ['tab U+0009', 0x09],
    ['line feed U+000A', 0x0a],
    ['vertical tab U+000B', 0x0b],
    ['form feed U+000C', 0x0c],
    ['carriage return U+000D', 0x0d],
    ['no-break space U+00A0', 0x00a0],
    ['ogham space mark U+1680', 0x1680],
    ['en quad U+2000', 0x2000],
    ['em quad U+2001', 0x2001],
    ['en space U+2002', 0x2002],
    ['thin space U+2009', 0x2009],
    ['hair space U+200A', 0x200a],
    ['line separator U+2028', 0x2028],
    ['paragraph separator U+2029', 0x2029],
    ['narrow no-break space U+202F', 0x202f],
    ['medium mathematical space U+205F', 0x205f],
    ['ideographic space U+3000', 0x3000],
  ]

  for (const [label, code] of separators) {
    const c = String.fromCodePoint(code)

    it(`leaves the link literal: ${label}`, () => {
      const html = carveToHtml(`[t](/u${c}"T")\n`)

      expect(isLink(html)).toBe(false)
      expect(html).toContain('[t](/u')
    })

    it(`leaves the image literal: ${label}`, () => {
      // `image_title = link_title`, and one producer serves both tails - so
      // this row needs no separate code change and gets its own fixture
      // anyway. The day the two paths split, nothing else would notice.
      const html = carveToHtml(`x ![a](/p.png${c}"T") y\n`)

      expect(isLink(html)).toBe(false)
      expect(html).toContain('![a](/p.png')
    })

    it(`leaves a single-quoted title literal too: ${label}`, () => {
      // The two quote spellings are separate alternatives in the pattern, so
      // narrowing one and not the other is a possible half-fix.
      const html = carveToHtml(`[t](/u${c}'T')\n`)

      expect(isLink(html)).toBe(false)
    })

    it(`is not rescued by a space beside it, in either order: ${label}`, () => {
      // The slot is one space, so `<SP>${label}` and `${label}<SP>` are both
      // failures - and they fail for DIFFERENT reasons, which is why both are
      // written. A fix spelled "the first character must be a space, then eat
      // whitespace" passes the row above and admits `<SP>c`; spelled as a
      // last-character test it admits `c<SP>` instead.
      expect(isLink(carveToHtml(`[t](/u ${c}"T")\n`))).toBe(false)
      expect(isLink(carveToHtml(`[t](/u${c} "T")\n`))).toBe(false)
    })
  }

  it('CONTROL: U+0085 was already literal, from the other side of the same swap', () => {
    // NEL is Unicode White_Space and is NOT in JavaScript's `\s`, so it never
    // opened this slot. No mutation of this change can move it; it is here so
    // a later rewrite towards `\p{White_Space}` cannot quietly admit it.
    expect(isLink(carveToHtml('[t](/u"T")\n'))).toBe(false)
  })

  it('CONTROL: one space still opens a title, for a link and for an image', () => {
    expect(carveToHtml('[t](/u "T")\n')).toContain('title="T"')
    expect(carveToHtml('x ![a](/p.png "T") y\n')).toContain('title="T"')
    expect(carveToHtml("[t](/u 'T')\n")).toContain('title="T"')
  })
})

describe('the slot is one space, not a run of them', () => {
  // markup-carve/carve#912: the production means exactly one `space`, and four
  // artifacts accepting a run were lax. A second space is therefore not a
  // link with a title, and not a link without one - it is not a link.
  for (const [label, gap] of [
    ['two spaces', '  '],
    ['three spaces', '   '],
  ] as const) {
    it(`leaves the link literal: ${label}`, () => {
      const html = carveToHtml(`[t](/u${gap}"T")\n`)

      expect(isLink(html)).toBe(false)
      expect(html).toContain('[t](/u')
    })

    it(`leaves the image literal: ${label}`, () => {
      expect(isLink(carveToHtml(`x ![a](/p.png${gap}"T") y\n`))).toBe(false)
    })
  }

  it('CONTROL: no separator at all is a link with no title, as before', () => {
    // The destination runs to the `)`, so `"T"` is part of it. Unchanged by
    // this narrowing, and the row that proves the narrowing did not simply
    // reject everything.
    const html = carveToHtml('[t](/u"T")\n')

    expect(isLink(html)).toBe(true)
    expect(html).not.toContain('title=')
  })
})

describe('the block-level image is the second producer of the same slot', () => {
  // A `![alt](dest "title")` alone on its line takes the captioned-figure path
  // and matches its OWN pattern. With `\s+` still spelled there, a tab-titled
  // image was literal inside a paragraph and a figure with a title on a line of
  // its own - one production, two answers, in one engine.
  for (const [label, c] of [
    ['tab', '\t'],
    ['no-break space', ' '],
    ['two spaces', '  '],
  ] as const) {
    it(`agrees with the inline path: ${label}`, () => {
      const block = carveToHtml(`![a](/p.png${c}"T")\n`)
      const inline = carveToHtml(`x ![a](/p.png${c}"T") y\n`)

      expect(isLink(block)).toBe(false)
      expect(isLink(inline)).toBe(false)
    })
  }

  it('agrees with the inline path on the byte order mark too', () => {
    // Asserted as AGREEMENT rather than as a literal, because U+FEFF is not a
    // separator at all under either spelling: `scanDestination` stops at the
    // White_Space PROPERTY, which excludes it, so the mark and the quoted run
    // are DESTINATION. That is the markup-carve/carve#860 question and not this
    // one.
    //
    // The two producers still disagreed about it. `RE_BARE_IMAGE` spelled its
    // own destination class `[^)\s]+`, and `\s` DOES hold U+FEFF - so a block
    // image took `title="T"` where the very same source inside a paragraph took
    // the mark into its `src` and no title at all.
    const block = carveToHtml('![a](/p.png﻿"T")\n')
    const inline = carveToHtml('x ![a](/p.png﻿"T") y\n')

    expect(block).not.toContain('title=')
    expect(inline).not.toContain('title=')
    expect(block).toContain('/p.png﻿&quot;T&quot;')
  })

  it('CONTROL: one space still builds the captioned figure', () => {
    const html = carveToHtml('![a](/p.png "T")\n')

    expect(html).toContain('<img')
    expect(html).toContain('title="T"')
  })
})
