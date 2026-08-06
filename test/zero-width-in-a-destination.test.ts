/*
 * A zero-width character is an ordinary destination character (carve-js#750,
 * spec markup-carve/carve#806).
 *
 * The grammar says which test to use, in as many words
 * (`resources/grammar.ebnf:1227-1229`):
 *
 *   ZERO-WIDTH characters (U+200B, U+FEFF) are NOT whitespace and ARE ordinary
 *   destination characters. The test is the Unicode White_Space property, not
 *   "is invisible".
 *
 * and, three lines further on, that the rule is not the inline scanner's alone:
 *
 *   THE SAME RULE APPLIES IN A REFERENCE DEFINITION, because the definition is
 *   built from this same `link_destination`.
 *
 * The destination scan used `/\s/`, and JavaScript's `\s` is White_Space PLUS
 * U+FEFF and MINUS U+0085 - a legacy set, not a Unicode property. So a
 * byte-order mark ended the destination and the whole link fell back to literal
 * text, while U+200B, equally invisible and equally not White_Space, was
 * accepted. One character singled out by an accident of the host language.
 *
 * carve-rs and carve-php both built the link.
 *
 * Every character in this file is written as an escape. A test about invisible
 * characters that spells them invisibly cannot be reviewed, and a normalizing
 * editor can silently change what it asserts.
 */

import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve, renderCarve } from '../src/index.js'
import type { Document } from '../src/ast.js'

/** The smallest document holding one link, so the writer can be fed an href
 *  no Carve source could express - a destination with a raw space in it. */
const linkTo = (destination: string): Document =>
  ({
    type: 'document',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'link', href: destination, children: [{ type: 'text', value: 'x' }] },
        ],
      },
    ],
  }) as unknown as Document

/** ZERO WIDTH NO-BREAK SPACE. In `\s`, not in White_Space: the whole bug. */
const BOM = '\u{FEFF}'
/** ZERO WIDTH SPACE. In neither: the control that always worked. */
const ZWSP = '\u{200B}'
/** NEXT LINE. In White_Space, NOT in `\s`: the same mismatch, other direction. */
const NEL = '\u{0085}'
/** NO-BREAK SPACE. Really is White_Space, and invisible. */
const NBSP = '\u{00A0}'
/** NARROW NO-BREAK SPACE. Really is White_Space. */
const NNBSP = '\u{202F}'

const href = (source: string): string | null =>
  /<a href="([^"]*)"/.exec(carveToHtml(source))?.[1] ?? null

const imageSrc = (source: string): string | null =>
  /<img src="([^"]*)"/.exec(carveToHtml(source))?.[1] ?? null

const isLink = (source: string): boolean => carveToHtml(source).includes('<a href')

describe('a zero-width character in an inline link destination', () => {
  it('does not end the destination at its start', () => {
    expect(href(`[x](${BOM}https://e.com/)\n`)).toBe(`${BOM}https://e.com/`)
  })

  it('does not end the destination in the middle', () => {
    expect(href(`[x](https://e${BOM}.com/)\n`)).toBe(`https://e${BOM}.com/`)
  })

  it('does not end the destination at its end', () => {
    expect(href(`[x](https://e.com/${BOM})\n`)).toBe(`https://e.com/${BOM}`)
  })

  it('behaves the same for U+200B, which always worked', () => {
    // The control: this one was already accepted, and the fix must not have
    // reached it by widening something.
    expect(href(`[x](${ZWSP}https://e.com/)\n`)).toBe(`${ZWSP}https://e.com/`)
  })
})

describe('a zero-width character in a REFERENCE DEFINITION destination', () => {
  /*
   * These are the rows carve-js#751 did not reach. `RE_LINK_DEF` matched the
   * destination with `(\S+)` and skipped the separator run with a class built
   * on `\S`, so a BOM was either skipped as leading whitespace or cut the
   * destination short.
   *
   * The assertion is on the VALUE, not on whether a link was produced. The
   * guard this file used to carry asked only `isLink(...) === true`, and every
   * one of these rows DOES produce a link - with the wrong href. So it passed
   * against the defect for as long as the defect existed, and the ticket was
   * closed on the strength of it. A check that cannot fail is not evidence.
   */
  it('keeps a leading BOM instead of skipping it as separator whitespace', () => {
    expect(href(`[r]: ${BOM}https://e.com/\n\nsee [x][r]\n`)).toBe(`${BOM}https://e.com/`)
  })

  it('does not truncate the destination at a BOM in the middle', () => {
    expect(href(`[r]: https://e${BOM}.com/\n\nsee [x][r]\n`)).toBe(`https://e${BOM}.com/`)
  })

  it('keeps a trailing BOM', () => {
    expect(href(`[r]: https://e.com/${BOM}\n\nsee [x][r]\n`)).toBe(`https://e.com/${BOM}`)
  })

  it('keeps a BOM in an angle-bracketed destination, which is ordinary text', () => {
    // There is no angle-bracket destination form (grammar.ebnf:1211-1213), so
    // `<` and `>` are ordinary characters. Truncating at the BOM left `<` alone
    // as the entire destination.
    expect(href(`[r]: <${BOM}https://e.com/>\n\nsee [x][r]\n`)).toBe(
      `&lt;${BOM}https://e.com/&gt;`,
    )
  })

  it('keeps a leading BOM on an IMAGE reference', () => {
    expect(imageSrc(`[r]: ${BOM}https://e.com/i.png\n\n![alt][r]\n`)).toBe(
      `${BOM}https://e.com/i.png`,
    )
  })

  it('does not read a BOM as the whitespace that introduces a title', () => {
    // No White_Space between the destination and the quoted run, so there is no
    // title: the quotes are part of the destination.
    const source = `[r]: https://e.com/${BOM}"t"\n\nsee [x][r]\n`
    expect(carveToHtml(source)).not.toContain('title=')
    expect(href(source)).toBe(`https://e.com/${BOM}&quot;t&quot;`)
  })

  it('a destination of nothing but a BOM is still a destination', () => {
    // "A definition whose destination is EMPTY once that is done is NOT a
    // definition" - and a BOM is not whitespace, so it is not empty.
    expect(href(`[r]: ${BOM}\n\nsee [x][r]\n`)).toBe(BOM)
  })

  it('behaves the same for U+200B, which always worked', () => {
    expect(href(`[r]: ${ZWSP}https://e.com/\n\nsee [x][r]\n`)).toBe(`${ZWSP}https://e.com/`)
  })
})

describe('U+0085 is White_Space even though it is not in JavaScript `\\s`', () => {
  /*
   * The same mismatch read the other way. `\S` accepted U+0085 as a destination
   * character, so the definition path carried it into the href where carve-php
   * and carve-rs both ended the destination on it. Testing the property fixes
   * both directions at once, which is why the fix is the property and not a
   * U+FEFF special case.
   */
  it('ends an inline destination', () => {
    expect(isLink(`[x](https://e${NEL}.com/)\n`)).toBe(false)
  })

  it('ends a definition destination', () => {
    expect(href(`[r]: https://e${NEL}.com/\n\nsee [x][r]\n`)).toBe('https://e')
  })

  it('is skipped as separator whitespace before a definition destination', () => {
    expect(href(`[r]: ${NEL}https://e.com/\n\nsee [x][r]\n`)).toBe('https://e.com/')
  })
})

describe('real whitespace still ends a destination', () => {
  it('a space does', () => {
    expect(isLink('[x]( https://e.com/)\n')).toBe(false)
  })

  it('a tab does', () => {
    expect(isLink('[x](\thttps://e.com/)\n')).toBe(false)
  })

  it('a no-break space does', () => {
    // U+00A0 IS White_Space, and invisible - the pair that shows the test is
    // the property and not visibility.
    expect(isLink(`[x](${NBSP}https://e.com/)\n`)).toBe(false)
  })

  it('a narrow no-break space ends a definition destination', () => {
    expect(href(`[r]: https://e${NNBSP}.com/\n\nsee [x][r]\n`)).toBe('https://e')
  })

  it('a tab is still separator whitespace in a definition', () => {
    expect(href('[r]: \thttps://e.com/\n\nsee [x][r]\n')).toBe('https://e.com/')
  })

  it('a definition whose destination is empty is not a definition', () => {
    expect(isLink('[r]:  \n\nsee [x][r]\n')).toBe(false)
  })
})

describe('the canonical writer does not percent-encode a BOM', () => {
  /*
   * `escapeDestination` percent-encoded `/\s/`, so `carve fmt` rewrote a BOM as
   * the literal text `%FEFF` - which is not even a well-formed percent escape,
   * and re-parses as those five characters. The INLINE path was fixed on the
   * way in and left wrong on the way out, so the writer's own invariant,
   * `toHtml(fmt(x)) === toHtml(x)`, did not hold on any of these.
   */
  const roundTrips = (source: string): void => {
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  }

  it('writes a BOM in an inline destination verbatim', () => {
    expect(carveToCarve(`[x](${BOM}https://e.com/)\n`)).toContain(`(${BOM}https://e.com/)`)
  })

  it('round-trips a BOM in an inline destination', () => {
    roundTrips(`[x](${BOM}https://e.com/)\n`)
  })

  it('round-trips a BOM in the middle of an inline destination', () => {
    roundTrips(`[x](https://e${BOM}.com/)\n`)
  })

  it('round-trips a BOM in an image destination', () => {
    roundTrips(`![alt](${BOM}https://e.com/i.png)\n`)
  })

  it('round-trips a BOM in a definition destination', () => {
    roundTrips(`[r]: ${BOM}https://e.com/\n\nsee [x][r]\n`)
  })

  it('does not un-blank a denied scheme hidden behind a BOM', () => {
    // PART 9 §25's probe strips the BOM, so this renders `href=""`. Writing the
    // BOM back out as `%FEFF` put a scheme the probe no longer recognizes in
    // front of it, and the formatted document rendered a destination the
    // original did not.
    expect(href(`[x](${BOM}javascript:alert(1))\n`)).toBe('')
    roundTrips(`[x](${BOM}javascript:alert(1))\n`)
  })

  it('still percent-encodes real whitespace', () => {
    // The control, and it has to go through the AST: no Carve source can put a
    // raw space in a destination, because a space ends one. Whitespace still
    // has to come out encoded, or the written document would not read back.
    expect(renderCarve(linkTo('https://e.com/a b'))).toContain('a%20b')
    expect(renderCarve(linkTo(`https://e.com/a${NBSP}b`))).not.toContain(
      `a${NBSP}b`,
    )
  })

  it('writes a BOM from the AST verbatim, where a space would be encoded', () => {
    expect(renderCarve(linkTo(`https://e.com/a${BOM}b`))).toContain(`a${BOM}b`)
  })
})

describe('the Markdown migrator does not percent-encode a BOM', () => {
  /*
   * `decodeEntitiesInDestination` percent-encoded `/\s/` on its way out, and
   * the destination/title split was made with `\S+`. A BOM is not whitespace in
   * CommonMark either, so cmark keeps it in the destination and the migrated
   * Carve has to as well.
   */
  it('keeps a leading BOM in an inline destination', () => {
    expect(markdownToCarve(`[x](${BOM}https://e.com/)\n`)).toContain(
      `[x](${BOM}https://e.com/)`,
    )
  })

  it('keeps a BOM in the middle of an inline destination', () => {
    expect(markdownToCarve(`[x](https://e${BOM}.com/)\n`)).toContain(
      `[x](https://e${BOM}.com/)`,
    )
  })

  it('keeps a BOM in a reference definition destination', () => {
    expect(markdownToCarve(`[r]: ${BOM}https://e.com/\n`)).toContain(
      `[r]: ${BOM}https://e.com/`,
    )
  })

  it('splits destination from title at whitespace, so the URL half is decoded as one', () => {
    // The split point is where the two halves stop being decoded the same way:
    // an entity in the destination becomes its character, an entity in what
    // follows is only decoded inside a quoted title. Cutting at the BOM put the
    // rest of the URL on the title side, where `&amp;` was left as written and
    // the migrated link pointed somewhere the Markdown source did not.
    expect(markdownToCarve(`[x](https://e${BOM}.com/?a&amp;b)\n`)).toContain(
      `https://e${BOM}.com/?a&b`,
    )
    expect(markdownToCarve(`[r]: https://e${BOM}.com/?a&amp;b\n`)).toContain(
      `https://e${BOM}.com/?a&b`,
    )
  })

  it('still percent-encodes a real space it decoded from an entity', () => {
    // The control: `&#32;` decodes to a space, which would end the destination,
    // so it has to come back out percent-encoded.
    expect(markdownToCarve('[x](https://e.com/a&#32;b)\n')).toContain('a%20b')
  })
})
