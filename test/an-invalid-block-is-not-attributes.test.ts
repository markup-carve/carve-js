import { describe, it, expect } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

/**
 * PART 7 `reference_definition`, AN INVALID BLOCK IS NOT `attributes`, SO THE
 * LINE IS NOT A DEFINITION -- NORMATIVE (markup-carve/carve#933).
 *
 * `[space, attributes]` names the `attributes` production, and a balanced
 * `{...}` that production does not accept is not an instance of it. It is
 * leftover content, and the end-of-line anchor (markup-carve/carve#911) disposes
 * of it like any other leftover: the line falls back to prose.
 *
 * WHY IT NEEDED SAYING WHEN THE ANCHOR ALREADY EXISTED: the anchor could not SEE
 * the failure. The trailing block is peeled off by a balance scan before
 * anything validates it, so a block that failed validation had already been
 * consumed and DISCARDED, and the line went on to parse as a definition with the
 * author's braces gone from the page. The remedy is structural: the scan hands a
 * rejected block BACK as content, a third outcome distinct both from "there was
 * no block" and from "the block was empty".
 */

/** Every `link_reference_definition` label the parse published. */
const defLabels = (src: string): string[] =>
  parse(src)
    .children.filter((b) => b.type === 'link_reference_definition')
    .map((b) => (b as { label: string }).label)

describe('an invalid attribute block is not attributes', () => {
  it('the three spellings the clause names are prose', () => {
    for (const block of ['{#}', '{ }', '{=}']) {
      expect(carveToHtml(`[a]: /u ${block}\n\n[a][]\n`)).toBe(
        `<p>[a]: /u ${block}</p>\n<p>[a][]</p>`,
      )
    }
  })

  it('a PARTLY valid block is prose, which emptiness alone cannot say', () => {
    // The row that separates the two halves of the gate. `{.c !!!}` parses to a
    // non-empty Attrs (class `c`), so an emptiness test alone accepts it and the
    // line defines with `!!!` silently dropped - the exact failure this clause
    // removes, one character further along. Only the VALIDITY test sees the
    // leftover.
    expect(carveToHtml('[a]: /u {.c !!!}\n\n[a][]\n')).toBe(
      '<p>[a]: /u {.c !!!}</p>\n<p>[a][]</p>',
    )
    // A digit-first name is the same case: `#1a` is not an identifier, so the
    // block is invalid, but `parseAttrs` still finds the bareword `a` in it.
    expect(carveToHtml('[a]: /u {#1a}\n\n[a][]\n')).toContain('<p>[a][]</p>')
    expect(carveToHtml('[a]: /u {#1a}\n')).not.toContain('<a ')
    // And a digit-first KEY, which reaches the same place by a third route.
    expect(carveToHtml('[a]: /u {.c 2=v}\n\n[a][]\n')).toBe(
      '<p>[a]: /u {.c 2=v}</p>\n<p>[a][]</p>',
    )
    // Inline, one construct away, all three already read as text (§14).
    expect(carveToHtml('x {.c !!!}\n')).toBe('<p>x {.c !!!}</p>')
    expect(carveToHtml('x {.c 2=v}\n')).toBe('<p>x {.c 2=v}</p>')
  })

  it('an empty block is prose too', () => {
    // `{}` is the same case: valid syntax naming no attribute, which the inline
    // scanner also refuses to consume.
    expect(carveToHtml('[a]: /u {}\n\n[a][]\n')).toBe('<p>[a]: /u {}</p>\n<p>[a][]</p>')
  })

  it('the reference below does not resolve', () => {
    // The visible consequence, stated separately from the rendering of the line
    // itself: a rejected line registers no label, so a document relying on it
    // resolves one fewer reference.
    expect(carveToHtml('[x][a]\n\n[a]: /u {#}\n')).toContain('<p>[x][a]</p>')
    expect(defLabels('[a]: /u {#}\n')).toEqual([])
  })

  it('the braces reach the page rather than being dropped', () => {
    // The failure this clause exists to prevent is not "the line still defined",
    // it is that the author's block vanished. A fix that rejected the block but
    // kept peeling it off would pass the resolution row above and fail here.
    expect(carveToHtml('[a]: /u {#}\n')).toContain('{#}')
  })

  it('reads the SAME way one construct away', () => {
    // The deciding argument: `x {#}` in a paragraph already keeps the braces as
    // text, because `attributes` rejects that block there too and inline content
    // keeps what it cannot parse.
    expect(carveToHtml('x {#}\n')).toBe('<p>x {#}</p>')
    expect(carveToHtml('x { }\n')).toBe('<p>x { }</p>')
    expect(carveToHtml('x {=}\n')).toBe('<p>x {=}</p>')
  })

  it('CONTROL a VALID block still defines and still transfers its attributes', () => {
    // The row an over-eager fix breaks.
    expect(carveToHtml('[Example][ex]\n\n[ex]: https://example.com {.external}\n')).toBe(
      '<p><a href="https://example.com" class="external">Example</a></p>',
    )
    expect(carveToHtml('[a][]\n\n[a]: /u {#x}\n')).toBe('<p><a href="/u" id="x">a</a></p>')
    // An UNQUOTED value is a `\S+` run. The validator reads the interior and
    // `parseAttrs` used to read the braced text, so this block validated as
    // `k=v` and parsed as `k=v}`, publishing `k="v}"`. Both now read one string.
    expect(carveToHtml('[a][]\n\n[a]: /u {k=v}\n')).toBe('<p><a href="/u" k="v">a</a></p>')
    expect(carveToHtml("[a][]\n\n[a]: /u {k=v}\n")).toBe('<p><a href="/u" k="v">a</a></p>')
    // A boolean attribute is a valid block naming an attribute, so it defines.
    expect(carveToHtml("[a][]\n\n[a]: /u {disabled=\"\"}\n")).toBe(
      '<p><a href="/u" disabled="">a</a></p>',
    )
    expect(defLabels('[a]: /u {.c}\n')).toEqual(['a'])
  })

  it('CONTROL a definition with NO block is untouched', () => {
    expect(carveToHtml('[a][]\n\n[a]: /u\n')).toBe('<p><a href="/u">a</a></p>')
  })

  it('CONTROL braces the destination owns are still the destination', () => {
    // `[a]: /u{.c}` has no separator space, so the braces were never a candidate
    // block; the destination keeps them. This must not be swept up as "invalid".
    expect(carveToHtml('[a][]\n\n[a]: /u{.c}\n')).toBe('<p><a href="/u{.c}">a</a></p>')
    // And a `{...}` that IS the whole destination stays one (the clause's
    // WHAT THE ANCHOR DOES NOT REJECT row, on the invalid spelling).
    expect(carveToHtml('[a][]\n\n[a]: /u{#}\n')).toBe('<p><a href="/u{#}">a</a></p>')
  })

  it('the rejected line still interrupts nothing it did not interrupt before', () => {
    // Every predicate that asks "is this line a definition" reads the same
    // splitter, so a rejected block makes the line an ordinary paragraph line
    // everywhere at once - here, a lazy continuation of the paragraph above.
    expect(carveToHtml('para\n[a]: /u {#}\n')).toBe('<p>para\n[a]: /u {#}</p>')
    // CONTROL: a VALID one still interrupts, which is what corpus 266 pins.
    expect(carveToHtml("para\n\n[a]: /u {.c}\n")).toBe('<p>para</p>')
  })
})
