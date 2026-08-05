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
 *
 * CAPTION NUMBERS are the other §5 result on this path, and the worse one: a
 * stale footnote number contradicted the renderer, a stale caption number is what
 * the renderer PRINTS. They are re-derived rather than cleared, because unlike a
 * footnote there is no local fact that makes one wrong - the survivor of a deleted
 * figure is stale only relative to the figures before it. Conditional on the
 * payload having published numbers at all, for the same §6 reason.
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

describe('a caption number on an ingested tree', () => {
  const TWO_FIGURES = '![a](/1.png)\n^ Figure #: one\n\n![b](/2.png)\n^ Figure #: two\n'

  /** The published tree with the FIRST figure deleted. */
  const withoutFirstFigure = (): Record<string, unknown> => {
    const tree = carveToAstJson(TWO_FIGURES) as unknown as { children: { type?: string }[] }
    const copy = JSON.parse(JSON.stringify(tree)) as typeof tree
    copy.children.splice(
      copy.children.findIndex((c) => c.type === 'figure'),
      1,
    )

    return copy as unknown as Record<string, unknown>
  }

  const captionNumbers = (tree: unknown): (number | undefined)[] => {
    const found: (number | undefined)[] = []
    const walk = (n: unknown): void => {
      if (n === null || typeof n !== 'object') return
      const node = n as { type?: string; n?: number }
      if (node.type === 'caption_number') found.push(node.n)
      for (const v of Object.values(n)) walk(v)
    }
    walk(tree)

    return found
  }

  it('numbers both figures while both are there', () => {
    expect(captionNumbers(carveToAstJson(TWO_FIGURES))).toEqual([1, 2])
  })

  it('renumbers the survivor when the first figure is deleted', () => {
    // Removing the figure a caption belongs to takes the caption with it and
    // proves nothing; the SURVIVOR is the one whose number goes stale.
    const republished = toAstJson(fromAstJson(withoutFirstFigure() as never))

    expect(captionNumbers(republished)).toEqual([1])
  })

  it('renders the number it publishes', () => {
    // The half that makes this a defect rather than a wire detail: the stale
    // value was PRINTED. A fresh parse of the same one-figure document is the
    // reference point.
    const html = renderHtml(fromAstJson(withoutFirstFigure() as never))

    expect(html).toContain('Figure 1: two')
    expect(html).not.toContain('Figure 2')
  })

  it('leaves an unedited tree exactly as it arrived', () => {
    // The pass runs on every ingest, so the no-op case matters more than the fix
    // case: both numbers, in order, unchanged.
    const tree = carveToAstJson(TWO_FIGURES)
    const back = toAstJson(fromAstJson(JSON.parse(JSON.stringify(tree)) as never))

    expect(back).toEqual(tree)
  })

  it('does not number a tree that published no numbers', () => {
    // §6, and the reason this is conditional. `parse()` does no caption
    // numbering in this engine, so its serialized tree carries no `n` - and
    // reading it back must not add any.
    const json = toAstJson(parse(TWO_FIGURES))
    expect(captionNumbers(json)).toEqual([undefined, undefined])

    const back = toAstJson(fromAstJson(JSON.parse(JSON.stringify(json))))
    expect(back).toEqual(json)
  })
})
