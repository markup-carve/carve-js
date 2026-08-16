import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve, parse } from '../src/index.js'

/**
 * AN EMPTY LINK TEXT IS ALLOWED AND PRODUCES AN EMPTY ANCHOR (PART 9 §4), and
 * that holds for the REFERENCE form and not only the inline one
 * (markup-carve/carve-js#1119, ruled 2026-08-16). carve-rs and carve-php both
 * resolve `[][d]`; this engine left it as literal text.
 *
 * RECOGNITION IS NOT RESOLUTION. The reference branch demanded a non-empty
 * TEXT before it would build a node at all, so `[][d]` was not an unresolved
 * reference - it was never a reference, and no definition could reach it. The
 * emptiness question belongs one stage later, where a label that names nothing
 * simply fails to look up.
 *
 * THE ENGINE ALREADY DISAGREED WITH ITSELF IN TWO PLACES, which is what makes
 * this a defect rather than a reading:
 *   - `[](u)` - the inline form with the same empty text - resolves.
 *   - `![][d]` - the IMAGE reference - resolves, because the image branch
 *     asks the question about the LABEL ("full allows an empty alt; collapsed
 *     needs a non-empty alt to use as the label") rather than about the text.
 *
 * DROPPING THE GUARD ALSO SETTLES `[][]`, AND THAT IS THE INTENDED EFFECT, not
 * collateral. Collapsed with an empty text means an empty label, which names
 * nothing - but it is still a reference node that fails to resolve, exactly as
 * `[][nope]` is, and it finalizes back to its own source. Both oracles build
 * that node. Verified 2026-08-16 against carve-rs `69e456e` and carve-php
 * `e140311`, both built from `origin/main`:
 *
 *   [][]  ->  link { ref: "", rawRef: "[][]", href: "", children: [] }
 *
 * carve-js alone made it a Text node, so the two engines' ASTs differed on a
 * document whose HTML agreed - and `[][]{.c}` came out an inline span here and
 * literal text in both oracles. The rows below pin all three.
 */

/** The href a document's first link resolves to, or null when none resolved. */
const href = (src: string): string | null => /<a href="([^"]*)"/.exec(carveToHtml(src))?.[1] ?? null

/** The first paragraph's inline children, minus positions. */
const inlines = (src: string): Array<Record<string, unknown>> => {
  const para = parse(src).children.find((n) => n.type === 'paragraph')
  return (para as { children: Array<Record<string, unknown>> }).children
}

describe('an empty link text resolves its explicit reference label', () => {
  it('resolves the empty-text full reference', () => {
    expect(carveToHtml('[d]: u\n\n[][d]\n')).toBe('<p><a href="u"></a></p>')
  })

  it('leaves a genuinely undefined label unresolved, empty text or not', () => {
    // The other direction of the ruling: recognizing the node must not make it
    // resolve to anything, and its literal fallback is the source as written.
    expect(carveToHtml('[][nope]\n')).toBe('<p>[][nope]</p>')
    expect(href('[][nope]\n')).toBe(null)
    // With a definition present under a DIFFERENT label, so the table is
    // non-empty and the miss is a real lookup miss rather than an empty table.
    expect(carveToHtml('[d]: u\n\n[][nope]\n')).toBe('<p>[][nope]</p>')
    expect(lintCarve('[][nope]\n').map((w) => w.rule)).toEqual(['unresolved-reference-link'])
  })

  it('carries the definition title and attributes onto the empty anchor', () => {
    // An empty text must not become a second-class link: the full transfer a
    // resolved reference gets (PART 9R R1) applies unchanged.
    expect(carveToHtml('[d]: u "t"\n\n[][d]\n')).toBe('<p><a href="u" title="t"></a></p>')
    expect(carveToHtml('[d]: u {.wide}\n\n[][d]\n')).toBe('<p><a href="u" class="wide"></a></p>')
    // The use site's own attributes merge over the definition's, as for any
    // other reference.
    expect(carveToHtml('[d]: u\n\n[][d]{.c}\n')).toBe('<p><a href="u" class="c"></a></p>')
  })

  it('keeps `ref` and `rawRef` beside the destination', () => {
    // PART 12 §3a: a RESOLVED reference keeps both. The empty-text spelling is
    // not an exception, and an AST consumer must still be able to tell
    // `[][d]` from `[](u)`.
    const [link] = inlines('[d]: u\n\n[][d]\n')
    expect(link!.type).toBe('link')
    expect(link!.href).toBe('u')
    expect(link!.ref).toBe('d')
    expect(link!.rawRef).toBe('[][d]')
    expect(link!.children).toEqual([])
  })

  it('builds the collapsed empty form as an UNRESOLVED reference, not as text', () => {
    // The AST both oracles build. This is the row that separates "the guard
    // moved to resolution" from "the guard was narrowed to spare `[][]`" -
    // the two are indistinguishable in HTML and differ here.
    const [node] = inlines('[][]\n')
    expect(node!.type).toBe('link')
    expect(node!.ref).toBe('')
    expect(node!.rawRef).toBe('[][]')
    expect(node!.href).toBe('')
    expect(node!.children).toEqual([])
    // And it still RENDERS as its own source, with or without a definition in
    // scope, because an empty label reaches no entry.
    expect(carveToHtml('[][]\n')).toBe('<p>[][]</p>')
    expect(carveToHtml('[d]: u\n\n[][]\n')).toBe('<p>[][]</p>')
    expect(href('[d]: u\n\n[][]\n')).toBe(null)
  })

  it('consumes a trailing attribute block on the collapsed empty form', () => {
    // Follows from the row above: once `[][]` is a reference, its `{.c}` is the
    // reference's attribute block and travels into `rawRef`, so the literal
    // fallback is the whole source. carve-js alone used to split this into a
    // `[]` text node plus an inline span.
    expect(carveToHtml('[][]{.c}\n')).toBe('<p>[][]{.c}</p>')
    expect(inlines('[][]{.c}\n').map((n) => n.type)).toEqual(['link'])
  })

  it('CONTROL a non-empty text still resolves, in both spellings', () => {
    // Without these the guard could have been inverted rather than moved.
    expect(href('[d]: u\n\n[t][d]\n')).toBe('u')
    expect(href('[d]: u\n\n[d][]\n')).toBe('u')
  })

  it('CONTROL the inline empty-text form is untouched', () => {
    // The spelling that always worked, and the reason the ticket could say the
    // empty text was not the obstacle.
    expect(carveToHtml('[](u)\n')).toBe('<p><a href="u"></a></p>')
  })

  it('CONTROL the IMAGE reference branch is unchanged in both directions', () => {
    // The branch this fix was modelled on; it is not edited and must not move.
    expect(carveToHtml('[d]: u\n\n![][d]\n')).toBe('<img src="u" alt="">')
    expect(carveToHtml('[d]: u\n\n![][]\n')).toBe('<p>![][]</p>')
  })

  it('CONTROL a bracketed run followed by attributes is still an inline span', () => {
    // `[][]{.c}` moving to the reference branch must not drag the ORDINARY
    // span form (PART 9 §14) with it - that one has no second bracket pair.
    expect(carveToHtml('[text]{.c}\n')).toBe('<p><span class="c">text</span></p>')
  })

  it('lint agrees with the resolver', () => {
    // `lint.ts` asks the same question from its own index; a reference that now
    // resolves must stop being reported.
    expect(lintCarve('[d]: u\n\n[][d]\n')).toEqual([])
  })
})
