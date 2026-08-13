import { describe, it, expect } from 'vitest'
import { carveToAstJson } from '../src/index.js'

/**
 * A figure carries a position, like every other node but the root.
 *
 * PART 12 §4 asks for one, and the parser already computes the span this needs:
 * each of the four figure sites calls `attachBlockPos` on the figure's TARGET,
 * precisely so the wrapped block is not left position-less - and then returns a
 * figure with nothing on it.
 *
 * carve-php publishes the span (image line through caption line); carve-js and
 * carve-rs publish none, which the spec repo's AST conformance run reports as
 * `missing pos on "figure"` for corpus 207-a-reference-image-takes-a-caption.
 *
 * The figure is the node a consumer maps a click or a diagnostic to - the
 * target inside it is an implementation detail of how a caption attaches - so
 * "the child has one" is not a substitute.
 */
describe('a figure carries its own position', () => {
  const figureOf = (src: string): Record<string, unknown> | null => {
    let found: Record<string, unknown> | null = null
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>
        if (record.type === 'figure') found ??= record
        Object.values(record).forEach(walk)
      }
    }
    walk(carveToAstJson(src))
    return found
  }

  const cases: Array<[string, string]> = [
    ['an image', '![a](p.png)\n^ cap\n'],
    ['a reference image', '![a][ok]\n^ cap\n\n[ok]: /p.png\n'],
    ['a code block', '```\ncode\n```\n^ cap\n'],
    ['display math', '$$`x`\n^ cap\n'],
  ]

  for (const [what, src] of cases) {
    it(`has one on a figure wrapping ${what}`, () => {
      const figure = figureOf(src)
      expect(figure, `no figure node for ${what}`).not.toBeNull()
      expect(figure!.pos, `figure wrapping ${what} has no pos`).toBeDefined()
    })
  }

  it('gives a captioned quote a position, and no figure', () => {
    // PART 9 §4a: a captioned quote is a `block_quote` carrying an
    // `attribution`, not a figure wrapping the quote (carve#1159). It keeps the
    // span the figure used to carry - the quote plus its attribution line - so
    // no node is left without one.
    expect(figureOf('> quoted\n^ cap\n')).toBeNull()
    const doc = carveToAstJson('> quoted\n^ cap\n') as unknown as {
      children: Array<Record<string, unknown>>
    }
    const quote = doc.children[0]!
    expect(quote['type']).toBe('block_quote')
    expect(quote['attribution']).toBeDefined()
    const pos = quote['pos'] as Record<string, number>
    expect(pos.startLine).toBe(1)
    expect(pos.endLine).toBe(2)
  })

  it('spans the target and the caption together', () => {
    // The image is line 1 and the caption line 2, so the figure covers both -
    // this is what carve-php publishes for the same input.
    const figure = figureOf('![a](p.png)\n^ cap\n')
    const pos = figure!.pos as Record<string, number>
    expect(pos.startLine).toBe(1)
    expect(pos.endLine).toBe(2)
  })

  it('spans the reference-image figure the same way', () => {
    // The site this fixes: a paragraph holding a reference image plus a caption
    // is promoted to a figure AFTER parsing, so it never passed through the
    // block loop that gives the other four sites their span. carve-php
    // publishes lines 1-2 for this input.
    const figure = figureOf('![a][ok]\n^ cap\n\n[ok]: /p.png\n')
    const pos = figure!.pos as Record<string, number>
    expect(pos.startLine).toBe(1)
    expect(pos.endLine).toBe(2)
  })

  it('leaves the target its own position', () => {
    // The reason the sites call attachBlockPos in the first place: the wrapped
    // block must not lose its span to the wrapper.
    const figure = figureOf('![a](p.png)\n^ cap\n')
    const target = figure!.target as Record<string, unknown>
    expect(target.pos, 'the wrapped block lost its position').toBeDefined()
  })
})
