import { describe, it, expect } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

/*
 * A DEGRADED COMMENT FENCE KEEPS ITS OWN COLUMN (markup-carve/carve-js#1623).
 *
 * carve-js#1607 stopped a degraded `%%%` at a container's column 0 from ending
 * the item, so for the first time such a line is COLLECTED as a lazy
 * continuation. The collector there reduces a block-shaped below-column line to
 * one column of indentation, and it did so by stripping and prepending a space
 * - which on a line already at column 0 adds a character the author never
 * wrote. `attachDocumentOffsets` then charges it back to the document: the
 * sub-line is one longer than its document line, the prefix goes to -1, and the
 * span starts on the newline ENDING THE LINE ABOVE, with `startColumn: 0`.
 *
 * That is below the AST schema's `integer >= 1`, so carve's own ingest throws
 * on carve-js's output and the finding lands in the class that has no ledger by
 * design. The `%%` spelling of the same document never took that branch and is
 * the control: same geometry, correct position all along.
 *
 * The clamp is kept where it has work to do - an INDENTED block-shaped line
 * still comes down to one column, which is what stops it reaching a sublist's
 * content column on the recursive reparse (carve#603).
 */

const commentsOf = (src: string): { pos: { startLine: number; startColumn: number; endColumn: number; startOffset: number; endOffset: number } }[] => {
  const out: any[] = []
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'comment') out.push(n)
    for (const k of ['children', 'items']) if (Array.isArray(n[k])) n[k].forEach(walk)
  }
  walk(carveToAstJson(src, { positions: true }))
  return out
}

/** Every published comment span, sliced back out of the source it claims. */
const spans = (src: string): string[] =>
  commentsOf(src).map((c) => src.slice(c.pos.startOffset, c.pos.endOffset))

describe('the span a degraded comment fence publishes is the fence', () => {
  it('the reported document [corpus 445]', () => {
    const src = '- x\n%%%\ny\n'
    expect(commentsOf(src)[0]!.pos).toEqual({
      startLine: 2,
      endLine: 2,
      startColumn: 1,
      endColumn: 4,
      startOffset: 4,
      endOffset: 7,
    })
  })

  it('the `%%` spelling has the same geometry [control]', () => {
    const src = '- x\n%% z\ny\n'
    expect(commentsOf(src)[0]!.pos).toEqual({
      startLine: 2,
      endLine: 2,
      startColumn: 1,
      endColumn: 5,
      startOffset: 4,
      endOffset: 8,
    })
  })

  it.each([
    ['445', '- x\n%%%\ny\n', ['%%%']],
    ['445-4, an ordered marker', '1. x\n%%%\ny\n', ['%%%']],
    ['445-5, a wide marker', '-   x\n%%%\ny\n', ['%%%']],
    ['445-6, a nested item', '- - x\n  %%%\n  y\n', ['%%%']],
    ['445-7, width 4', '- x\n%%%%\ny\n', ['%%%%']],
    ['445-8, two fences of different widths', '- x\n%%%\n%%%%\ny\n', ['%%%', '%%%%']],
    ['445-10, a sibling marker below', '- x\n%%%\n- y\n', ['%%%']],
  ])('%s', (_name, src, expected) => {
    expect(spans(src)).toEqual(expected)
  })

  it('every published start is a legal schema position', () => {
    for (const src of [
      '- x\n%%%\ny\n',
      '1. x\n%%%\ny\n',
      '-   x\n%%%\ny\n',
      '- - x\n  %%%\n  y\n',
      '- x\n%%%%\ny\n',
      '- x\n%%%\n%%%%\ny\n',
      '- x\n%%%\n- y\n',
    ]) {
      for (const c of commentsOf(src)) {
        expect(c.pos.startColumn).toBeGreaterThanOrEqual(1)
        expect(c.pos.startOffset).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('the clamp still applies where the line has indentation to reduce', () => {
  it('an indented comment fence stays with the item [corpus 187]', () => {
    const src = '- a\n %%% n\n x\n %%%\n tail\n'
    // THE CLAMP IS ABOUT THE PARSE, NOT THE SPAN. It still reduces the line to
    // one column - the HTML below is what says so, and it has not moved - but
    // the span no longer opens on that column. A comment is a LEAF, and a leaf
    // begins at its markup (markup-carve/carve#1928, carve-js#1631); only a
    // container keeps the latitude to begin inside the indentation that places
    // its child's marker. This row read `' %%% n...'`, one space early.
    expect(spans(src)).toEqual(['%%% n\n x\n %%%'])
    expect(carveToHtml(src)).toBe('<ul>\n  <li>a\n    tail\n  </li>\n</ul>')
  })

  it('a below-column bullet still folds instead of nesting a sublist [carve#603]', () => {
    // The one column this branch exists to leave behind: strip it entirely and
    // `b` nests under `a` instead of folding.
    expect(carveToHtml('-   x\n    - a\n  - b\n')).toBe(
      '<ul>\n  <li>x\n    <ul>\n      <li>a\n- b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
