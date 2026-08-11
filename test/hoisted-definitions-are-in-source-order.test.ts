import { describe, it, expect } from 'vitest'
import { carveToAstJson } from '../src/index.js'

/*
 * PART 12 §7: "Definitions appear in DOCUMENT ORDER by source position."
 *
 * Collecting a definition moves it to the document, and §4 keeps the `pos` it
 * was written at. The order the collected definitions are PUBLISHED in was a
 * side effect of the collection machinery instead: link definitions were
 * appended by the parser and footnotes by the serializer, so a link definition
 * always preceded a footnote however the author had ordered them, and `pos` ran
 * backwards across two adjacent siblings.
 *
 * carve#746. The measurement that hides it is a single document whose footnote
 * happens to be written first, where kind order and source order agree.
 */
const kinds = (source: string): string[] =>
  carveToAstJson(source).children.map((child) => child.type)

describe('collected definitions of different kinds', () => {
  it('publishes a footnote written first before a link definition', () => {
    expect(kinds("see[^a] and [t][r]\n\n[^a]: note\n\n[r]: /u\n")).toEqual([
      'paragraph',
      'footnote',
      'link_reference_definition',
    ])
  })

  it('publishes a link definition written first before a footnote', () => {
    expect(kinds('[r]: /u\n[^a]: note\n\nsee[^a] and [t][r]\n')).toEqual([
      'paragraph',
      'link_reference_definition',
      'footnote',
    ])
  })

  it('orders three definitions of two kinds by source position', () => {
    expect(
      kinds("see[^a] and [t][r] and [u][s]\n\n[r]: /u\n\n[^a]: note\n\n[s]: /v\n"),
    ).toEqual([
      'paragraph',
      'link_reference_definition',
      'footnote',
      'link_reference_definition',
    ])
  })

  it('leaves the published positions ascending across the collected tail', () => {
    const children = carveToAstJson(
      "see[^a] and [t][r]\n\n[^a]: note\n\n[r]: /u\n",
    ).children
    const tail = children.filter(
      (child) =>
        child.type === 'footnote' || child.type === 'link_reference_definition',
    )
    const offsets = tail.map((child) => child.pos?.startOffset)
    expect(offsets).toEqual([...offsets].sort((a, b) => (a ?? 0) - (b ?? 0)))
  })
})
