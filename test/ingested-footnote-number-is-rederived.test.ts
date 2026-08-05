import { describe, expect, it } from 'vitest'
import { carveToAstJson, fromAstJson, parse, renderHtml, toAstJson } from '../src/index.js'

/*
 * An ingested tree does not keep a footnote number it can no longer justify.
 *
 * PART 12 §5 serializes footnote numbering so a consumer need not reimplement
 * PART 9R. What it did not say is whether a published number has to agree with
 * what the engine would render for the same tree. On a parsed document the
 * question never arises; on an INGESTED one it does (carve#758).
 *
 * The shape is what an editor produces when a user deletes a footnote
 * definition and hands the document back. Every engine renders the result the
 * same way - the reference no longer resolves, so it falls back to its literal
 * source - but this engine re-published `number: 1` for a footnote that is not
 * in the document, contradicting its own renderer on the same tree. carve-php
 * already dropped it.
 *
 * THE RULE IS CLEAR, NEVER ASSIGN, and the difference is not cosmetic. Running
 * the full numbering pass here breaks PART 12 §6: that round trip is `parse(x)`
 * serialized and deserialized, and `parse()` alone does no numbering - resolution
 * does - so a tree that legitimately carries no numbers would come back carrying
 * them. Two existing round-trip cases caught exactly that when this was first
 * written the other way.
 *
 * INLINE FOOTNOTES ARE LEFT ALONE. One carries its own body, so it cannot be
 * orphaned by a missing definition; only a reference can.
 */

const SOURCE = 'see[^a]\n\n[^a]: note\n'

/** SOURCE's published tree with the footnote definition deleted. */
function withDefinitionRemoved(): Record<string, unknown> {
  const tree = carveToAstJson(SOURCE) as unknown as {
    children: { type?: string }[]
  }
  const copy = JSON.parse(JSON.stringify(tree)) as typeof tree
  copy.children = copy.children.filter((c) => c.type !== 'footnote')

  return copy as unknown as Record<string, unknown>
}

const numbersIn = (tree: unknown): (number | undefined)[] => {
  const found: (number | undefined)[] = []
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== 'object') return
    const node = n as { type?: string; number?: number }
    if (node.type === 'footnote_ref') found.push(node.number)
    for (const v of Object.values(n)) walk(v)
  }
  walk(tree)

  return found
}

describe('a footnote number on an ingested tree', () => {
  it('is published while the definition is there', () => {
    // The baseline. Without it, every assertion below would also pass if the
    // number had stopped being published at all.
    expect(numbersIn(carveToAstJson(SOURCE))).toEqual([1])
  })

  it('is dropped when the definition is not', () => {
    const republished = toAstJson(fromAstJson(withDefinitionRemoved() as never))

    expect(numbersIn(republished)).toEqual([undefined])
  })

  it('agrees with what the same tree renders', () => {
    // The actual defect: the wire said "footnote 1" and the renderer said the
    // reference never formed. Both are asserted here so they cannot drift apart
    // again in either direction.
    const doc = fromAstJson(withDefinitionRemoved() as never)

    expect(numbersIn(toAstJson(doc))).toEqual([undefined])
    expect(renderHtml(doc)).toContain('see[^a]')
    expect(renderHtml(doc)).not.toContain('doc-noteref')
  })

  it('keeps the reference itself, and its label', () => {
    // The boundary. Dropping the node would also satisfy the assertions above.
    const republished = JSON.stringify(toAstJson(fromAstJson(withDefinitionRemoved() as never)))

    expect(republished).toContain('"footnote_ref"')
    expect(republished).toContain('"id":"a"')
  })

  it('does not INVENT a number on an unresolved tree', () => {
    // PART 12 §6, and the reason this clears rather than renumbers. `parse()`
    // does no numbering, so its serialized tree carries none - and reading it
    // back must not add any, or the round trip stops holding.
    const json = toAstJson(parse(SOURCE))
    expect(numbersIn(json)).toEqual([undefined])

    const back = toAstJson(fromAstJson(JSON.parse(JSON.stringify(json))))
    expect(back).toEqual(json)
  })

  it('leaves an inline footnote alone', () => {
    // It carries its own body, so no deletion can orphan it.
    const tree = carveToAstJson('a ^[note] b\n')
    const back = toAstJson(fromAstJson(JSON.parse(JSON.stringify(tree)) as never))

    expect(JSON.stringify(back)).toBe(JSON.stringify(tree))
  })

  it('leaves a tree whose definitions are intact untouched', () => {
    // The other boundary: ingesting an unedited published tree changes nothing.
    const tree = carveToAstJson(SOURCE)
    const back = toAstJson(fromAstJson(JSON.parse(JSON.stringify(tree)) as never))

    expect(back).toEqual(tree)
  })
})
