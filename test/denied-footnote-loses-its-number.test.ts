/*
 * A footnote a profile took away leaves nothing numbered behind it.
 *
 * `resolve()` numbers footnotes and the profile filter runs AFTER it, so a
 * denied definition used to leave the reference numbered for a document that no
 * longer existed. The rendered output showed it plainly (carve-js#698):
 *
 *   <p>Text<a id="undefined" href="#fn1" role="doc-noteref"><sup>1</sup></a>.</p>
 *
 * `id="undefined"` is the JavaScript value interpolated into an attribute - the
 * backlink anchor is assigned while the endnotes section renders, and the
 * profile removed the definition, so that never happened. `href="#fn1"` pointed
 * at a target no longer in the document. Both follow from the same stale number.
 *
 * TWO HALVES, because the two paths lose it differently. `renderHtml` renumbers
 * off the filtered tree, so it only needed the numbering pass to CLEAR a number
 * it can no longer justify instead of skipping the node. The published AST is
 * never renumbered after filtering at all, so the filter has to ask for it.
 *
 * carve-rs already rendered the literal `[^a]` here, which is what this engine
 * now produces byte for byte.
 */

import { describe, expect, it } from 'vitest'
import { applyProfile, carveToAstJson, carveToHtml, parse, Profile } from '../src/index.js'

const DENIED = 'Text[^a].\n\n[^a]: note\n'

/** Every footnote-ish node as [type, number], in document order. */
function notes(tree: unknown): Array<[string, number | undefined]> {
  const found: Array<[string, number | undefined]> = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const n = node as { type?: string; number?: number }
    if (n.type === 'footnote_ref' || n.type === 'inline_footnote') found.push([n.type, n.number])
    for (const value of Object.values(node)) walk(value)
  }
  walk(tree)
  return found
}

const denyFootnotes = (): Profile => Profile.full().denyBlock(['footnote'])

describe('a denied footnote definition', () => {
  it('renders the reference as its literal source', () => {
    // The reported line, fixed. An unresolved reference has always degraded to
    // `[^a]`; a denied one now takes the same path rather than a separate one.
    expect(carveToHtml(DENIED, { profile: denyFootnotes() })).toBe('<p>Text[^a].</p>')
  })

  it('puts no undefined in the output at all', () => {
    // Broader than the assertion above on purpose: `undefined` reaching HTML is
    // a defect wherever it lands, not only in this attribute.
    expect(carveToHtml(DENIED, { profile: denyFootnotes() })).not.toContain('undefined')
  })

  it('links to no target that was removed', () => {
    const html = carveToHtml(DENIED, { profile: denyFootnotes() })
    expect(html).not.toContain('href="#fn1"')
    expect(html).not.toContain('doc-noteref')
  })

  it('publishes no number in the AST either', () => {
    // The half `renderHtml` cannot fix for itself: nothing renumbers the tree a
    // consumer receives, so the filter has to.
    expect(notes(carveToAstJson(DENIED, { profile: denyFootnotes() }))).toEqual([
      ['footnote_ref', undefined],
    ])
  })

  it('leaves an inline footnote numbered from one', () => {
    // The mixed document, where "clear every number" and "renumber" differ. The
    // references are gone from the sequence, so the inline note is 1, not 2.
    const src = 'a[^x] b ^[inline] c[^x]\n\n[^x]: note\n'
    expect(notes(carveToAstJson(src, { profile: denyFootnotes() }))).toEqual([
      ['footnote_ref', undefined],
      ['inline_footnote', 1],
      ['footnote_ref', undefined],
    ])
    // And the rendered document agrees, which is the actual invariant.
    expect(carveToHtml(src, { profile: denyFootnotes() })).toContain('<sup>1</sup>')
  })

  it('renumbers when the reference went away inside a denied container', () => {
    // The path a check on the removed node's own type misses: the blockquote is
    // what the profile denies, and `[^a]` is merely inside it. `[^b]` was 2.
    const src = '> q[^a]\n\nafter[^b]\n\n[^a]: one\n[^b]: two\n'
    const profile = Profile.full().denyBlock(['block_quote'])

    expect(notes(carveToAstJson(src))).toEqual([
      ['footnote_ref', 1],
      ['footnote_ref', 2],
    ])
    expect(notes(carveToAstJson(src, { profile }))).toEqual([['footnote_ref', 1]])
    expect(carveToHtml(src, { profile })).toContain('href="#fn1"')
  })

  it('changes nothing without a profile', () => {
    // The boundary. Every assertion above would also pass if numbering had been
    // broken outright.
    expect(carveToHtml(DENIED)).toContain('<sup>1</sup>')
    expect(notes(carveToAstJson(DENIED))).toEqual([['footnote_ref', 1]])
  })

  it('still refuses nothing when a profile denies no footnote', () => {
    // The gate: a profile that removes something unrelated must not pay for a
    // renumber, and must not disturb the numbers either.
    const src = 'see[^a] ~~struck~~\n\n[^a]: note\n'
    const profile = Profile.full().denyInline(['delete'])

    expect(notes(carveToAstJson(src, { profile }))).toEqual([['footnote_ref', 1]])
  })

  it('does not renumber a deep document that lost no footnote', () => {
    // `numberFootnotes` carries the renderers' depth ceiling and this filter
    // does not, so an unconditional renumber would start refusing trees that
    // filter fine today. 300 quotes is past the ceiling and below the filter's.
    let node: unknown = { type: 'paragraph', children: [{ type: 'text', value: 'x' }] }
    for (let i = 0; i < 300; i++) node = { type: 'block_quote', children: [node] }
    const doc = { type: 'document', children: [node] } as unknown as ReturnType<typeof parse>

    expect(() => applyProfile(doc, Profile.full())).not.toThrow()
  })
})
