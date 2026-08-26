import { describe, expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

/*
 * PART 12 §4: a span "begins at the markup that opens the construct - ... a list
 * item's marker AND THE INDENTATION THAT PLACES IT". The run between a
 * container's content column and the marker is therefore inside the span, and a
 * nested list legitimately starts part way into a whitespace run, at its
 * parent's content column.
 *
 * carve-js#1516 anchored EVERY list and list_item at its marker. That is right
 * only inside a footnote or definition body, where an over-indented sublist
 * carries a block base of its own; everywhere else it dropped the placing
 * indentation and put this engine at odds with carve-rs and carve-php on nine
 * corpus documents (markup-carve/carve#1797).
 *
 * These read the AST through `carveToAstJson`, which is the path the spec's
 * three-way span comparison measures (`carve --json`). The parse-only path in
 * `authored-base-list-positions.test.ts` did not see the divergence.
 */
describe('a list span holds the indentation that places its marker', () => {
  it('starts an indented top-level list at column 1', () => {
    // spec corpus 05-lists-14
    const ast = carveToAstJson('  - a\n  - b\n') as any
    const list = ast.children[0]

    expect(list.type).toBe('list')
    expect(list.pos).toMatchObject({ startLine: 1, startColumn: 1, startOffset: 0, endOffset: 11 })
    expect(list.items[0].pos).toMatchObject({ startLine: 1, startColumn: 1, startOffset: 0 })
    expect(list.items[1].pos).toMatchObject({ startLine: 2, startColumn: 1, startOffset: 6 })
  })

  it("starts a nested list at its parent's content column, not at its marker", () => {
    // spec corpus 81-paragraph-interruption-15: the marker sits at column 4, one
    // past the item's content column, and the span opens at that content column.
    const ast = carveToAstJson('- a\n   - b\n') as any
    const nested = ast.children[0].items[0].children[1]

    expect(nested.type).toBe('list')
    expect(nested.pos).toMatchObject({ startLine: 2, startColumn: 3, startOffset: 6, endOffset: 10 })
    expect(nested.items[0].pos).toMatchObject({ startLine: 2, startColumn: 3, startOffset: 6 })
  })

  it('starts a rebased list in a footnote body at its marker', () => {
    // spec corpus 410-a-footnote-continuation-survives-a-blank-run-2: the body
    // rebases over-indented blocks with sublists included, so the marker column
    // IS the block's base and the span begins there (carve-js#1516).
    const ast = carveToAstJson('See[^1].\n\n[^1]: a\n\n\n    - b\n') as any
    const list = ast.children[1].children[1]

    expect(list.type).toBe('list')
    expect(list.pos).toMatchObject({ startLine: 6, startColumn: 5, startOffset: 24 })
    expect(list.items[0].pos).toMatchObject({ startLine: 6, startColumn: 5, startOffset: 24 })
  })
})
