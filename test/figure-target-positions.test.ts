import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

/**
 * A captioned block becomes a `figure` wrapping the block it captions. The
 * block loop attaches a span to whatever a parser returns, so it lands on the
 * FIGURE - and the target inside is left without one, which PART 12 §4 wants on
 * every node but the root.
 *
 * The captioned image and blockquote already placed their target; the fence and
 * the standalone equation did not (#462).
 */
const spanOf = (src: string, node: { pos?: { startOffset: number; endOffset: number } }): string =>
  [...src].slice(node.pos!.startOffset, node.pos!.endOffset).join('')

describe('a figure places the block it wraps', () => {
  it('a captioned fence', () => {
    const src = '```python\ndef greet():\n    return 1\n```\n^ Listing #: a greeting\n'
    const figure = parse(src).children[0] as { target: { pos?: { startOffset: number; endOffset: number } } }

    expect(figure.target.pos).toBeDefined()
    // The span covers the fence itself and stops before the caption line.
    expect(spanOf(src, figure.target)).toBe('```python\ndef greet():\n    return 1\n```')
  })

  it('a captioned standalone equation', () => {
    const src = '$$`E = mc^2`\n^ Equation #: mass-energy\n'
    const figure = parse(src).children[0] as { target: { pos?: { startOffset: number; endOffset: number } } }

    expect(figure.target.pos).toBeDefined()
    expect(spanOf(src, figure.target)).toBe('$$`E = mc^2`')
  })

  it('an uncaptioned fence is not wrapped and keeps its own span', () => {
    // The block loop places it directly; this pins that the change did not move
    // the span onto a figure that is not there.
    const src = '```py\nx = 1\n```\n'
    const block = parse(src).children[0] as { type: string; pos?: { startOffset: number; endOffset: number } }

    expect(block.type).toBe('code_block')
    expect(spanOf(src, block)).toBe('```py\nx = 1\n```')
  })
})
