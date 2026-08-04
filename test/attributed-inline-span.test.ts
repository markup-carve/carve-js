import { describe, it, expect } from 'vitest'
import { parse } from '../src/parse.js'
import type { InlineNode, Paragraph, Position } from '../src/ast.js'

/**
 * PART 12 §4 (carve#521): A TRAILING ATTRIBUTE BLOCK IS THE NODE'S OWN MARKUP,
 * so the span covers it.
 *
 * This is the existing "a span covers the markup the author wrote" rule applied
 * rather than a new one - the braces are where the node's `attrs` came from, so
 * a span stopping at `*x*` says the node ends before the markup that gave it
 * half its content. carve-js used to publish 0..3 here and carve-rs 0..7, which
 * left a consumer unable to select the styled text from an inline span without
 * knowing which engine produced the tree.
 */

const first = (src: string): InlineNode => (parse(src).children[0] as Paragraph).children[0]!

const span = (node: InlineNode): [number, number] => {
  const pos = (node as { pos?: Position }).pos!
  return [pos.startOffset!, pos.endOffset!]
}

describe('an inline node spans its trailing attribute block', () => {
  it('covers the block on a strong run', () => {
    expect(span(first('*x*{#i}\n'))).toEqual([0, 7])
  })

  it('covers the block on the combined form', () => {
    // The second case the clause names, because the DERIVED inner span is what
    // makes the difference observable: an engine that trims the outer span by
    // the two-character delimiters without taking the block off the end first
    // has the inner node claiming `x*/{#`.
    const outer = first('/*x*/{#id}\n')
    expect(span(outer)).toEqual([0, 10])
    expect(span((outer as unknown as { children: InlineNode[] }).children[0]!)).toEqual([2, 3])
  })

  it('leaves the inner span alone - it is the same with and without the block', () => {
    const bare = first('/*x*/\n') as unknown as { children: InlineNode[] }
    const attributed = first('/*x*/{#id}\n') as unknown as { children: InlineNode[] }
    expect(span(attributed.children[0]!)).toEqual(span(bare.children[0]!))
  })

  it('covers the block on a code span and on a link', () => {
    expect(span(first('`c`{#a}\n'))).toEqual([0, 7])
    expect(span(first('[l](u){#b}\n'))).toEqual([0, 10])
  })

  it('stops at the content when the block is not glued', () => {
    // A space between the node and the `{` leaves the block literal text, so
    // there is no markup of the node's own to cover.
    const node = first('*x* {#i}\n')
    expect(span(node)).toEqual([0, 3])
  })

  it('stops at the content when the payload is invalid', () => {
    // `{#1a}` is a digit-first identifier: the whole block stays literal (§14),
    // so it is not the node's markup either.
    expect(span(first('*x*{#1a}\n'))).toEqual([0, 3])
  })

  it('covers both blocks when two are glued in a row', () => {
    expect(span(first('*x*{#i}{.c}\n'))).toEqual([0, 11])
  })

  it('leaves the paragraph span alone', () => {
    // It always covered the block; only the inline node moved.
    const pos = (parse('*x*{#i}\n').children[0] as Paragraph).pos!
    expect([pos.startOffset, pos.endOffset]).toEqual([0, 7])
  })
})
