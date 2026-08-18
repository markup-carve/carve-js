import { describe, it, expect } from 'vitest'
import { parse, carveToCarve, carveToHtml } from '../src/index.js'

/*
 * A comment-only body line inside a line block is emptied at the BLOCK layer
 * (markup-carve/carve#1333) and put back into the tree as the `comment` node it
 * is, at the boundary that ends its line - so `carve fmt` writes the author's
 * own line back. Both halves of that walked the stanza's TOP-LEVEL nodes only,
 * so a boundary that ended up under an inline container hosted nothing and the
 * note's text was dropped (carve-js#1174).
 *
 * NO RENDER CHECK CAN SEE THIS, and neither can the round-trip invariant. The
 * comment publishes nothing, so `carveToHtml` agrees before and after; and the
 * dropped node made `carve fmt` write a bare `%%`, which re-parses to the same
 * tree the loss produced, so `parse(fmt(x)) == parse(x)` held while the author's
 * text was gone. That is the limit named on markup-carve/carve#1340, and it is
 * why the assertions below are on the TREE and on the written BYTES.
 */
describe('a verse comment nested under an inline container keeps its text', () => {
  /** Positions move with the source and are not what these rows are about. */
  const stripPos = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stripPos)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== 'pos')
          .map(([key, inner]) => [key, stripPos(inner)]),
      )
    }
    return value
  }

  const content = (src: string): unknown =>
    stripPos(
      ((parse(src).children[0] as { children: { children: unknown }[] }).children[0] as {
        children: unknown
      }).children,
    )

  it('keeps the comment node, with its content, inside the container', () => {
    const src = '::: |\n*a\n%% secret\nc*\n:::\n'
    expect(content(src)).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', value: 'a' },
          { type: 'soft_break' },
          { type: 'comment', block: false, content: 'secret' },
          { type: 'soft_break' },
          { type: 'text', value: 'c' },
        ],
      },
    ])
  })

  it('so fmt writes the authored line back, not a bare marker', () => {
    // The BYTES are the assertion: `%%` alone re-parses to the tree the loss
    // produced, so an invariant check passes either way and only the written
    // form tells them apart.
    expect(carveToCarve('::: |\n*a\n%% secret\nc*\n:::\n')).toBe(
      '::: |\n*a\n%% secret\nc*\n:::\n',
    )
  })

  it('at TWO levels of nesting as well - the depth is not the rule', () => {
    expect(carveToCarve('::: |\n*/a\n%% secret\nc/*\n:::\n')).toBe(
      '::: |\n*/a\n%% secret\nc/*\n:::\n',
    )
    expect(JSON.stringify(content('::: |\n*/a\n%% secret\nc/*\n:::\n'))).toContain('"secret"')
  })

  it('and in a container that is not emphasis', () => {
    expect(carveToCarve('::: |\n[a\n%% secret\nc](/u)\n:::\n')).toBe(
      '::: |\n[a\n%% secret\nc](/u)\n:::\n',
    )
    expect(carveToCarve('::: |\n{+a\n%% secret\nc+}\n:::\n')).toBe(
      '::: |\n{+a\n%% secret\nc+}\n:::\n',
    )
  })

  it('and in a container that holds its inlines under another name', () => {
    // An inline footnote carries its body in `inline` and an inline extension
    // in `content`, so a walk that knows only `children` misses both. Raised by
    // `codex review` on this branch.
    expect(carveToCarve('::: |\n^[a\n%% secret\nc]\n:::\n')).toBe(
      '::: |\n^[a\n%% secret\nc]\n:::\n',
    )
    expect(carveToCarve('::: |\n:kbd[a\n%% secret\nc]\n:::\n')).toBe(
      '::: |\n:kbd[a\n%% secret\nc]\n:::\n',
    )
  })

  it('a NESTED reinsertion carries its position, and no two nodes claim one byte', () => {
    // This omitted the position while carve-js#1182 stood: the comment's own
    // span was right, but the nodes it sits among were measured from the JOINED
    // text, which the emptied line made shorter than the source, so `c` below
    // reported the offset of a `%`. Publishing a correct span beside those
    // would have asserted that two nodes hold the same bytes, which PART 12
    // containment refuses, and PART 12 §4 sanctions omitting one instead. With
    // the stanza's line anchors carried into the nested scan the siblings are
    // measured from the line they were written on, so there is nothing left to
    // omit.
    const src = '::: |\n*a\n%% secret\nc*\n:::\n'
    const strong = (
      parse(src).children[0] as {
        children: {
          children: {
            pos: { startOffset: number; endOffset: number }
            children: {
              type: string
              pos?: { startOffset: number; endOffset: number }
            }[]
          }[]
        }[]
      }
    ).children[0]!.children[0]!
    const nodes = strong.children
    expect(nodes.map((n) => n.type)).toEqual([
      'text',
      'soft_break',
      'comment',
      'soft_break',
      'text',
    ])
    // Each node's span is the source it was authored at, so slicing the
    // document by it returns what the author wrote there.
    expect(nodes.map((n) => src.slice(n.pos!.startOffset, n.pos!.endOffset))).toEqual([
      'a',
      '\n',
      '%% secret',
      '\n',
      'c',
    ])
    // CONTAINMENT, which is the property the omission was protecting: the
    // siblings run in source order, none overlaps the next, and all of them sit
    // inside the emphasis that holds them.
    for (const [i, node] of nodes.entries()) {
      expect(node.pos!.startOffset).toBeGreaterThanOrEqual(
        i === 0 ? strong.pos.startOffset : nodes[i - 1]!.pos!.endOffset,
      )
      expect(node.pos!.endOffset).toBeLessThanOrEqual(strong.pos.endOffset)
    }
  })

  it('CONTROL: the TOP-LEVEL reinsertion still carries its position', () => {
    // There every break is re-posed from line geometry, so the spans agree and
    // there is nothing to omit.
    const nodes = (
      parse('::: |\na\n%% secret\nc\n:::\n').children[0] as {
        children: { children: { type: string; pos?: { startOffset: number } }[] }[]
      }
    ).children[0]!.children
    expect(nodes[2]!.type).toBe('comment')
    expect(nodes[2]!.pos?.startOffset).toBe(8)
  })

  it('publishes nothing, at either depth', () => {
    // The whole reason no render check could catch the loss.
    expect(carveToHtml('::: |\n*a\n%% secret\nc*\n:::\n')).not.toContain('secret')
    expect(carveToHtml('::: |\n*a\n%% secret\nc*\n:::\n')).toBe(
      carveToHtml('::: |\n*a\n%%\nc*\n:::\n'),
    )
  })

  it('CONTROL: an INDENTED `%%` line inside the container stays verse text', () => {
    // Only a line whose FIRST character is `%` is a comment line in verse, so
    // this one is content and must survive as content - published, not dropped.
    const src = '::: |\n*a\n  %% secret\nc*\n:::\n'
    expect(JSON.stringify(content(src))).toContain('%% secret')
    expect(carveToHtml(src)).toContain('%% secret')
  })

  it('CONTROL: a comment an OPEN RUN swallowed still does not survive', () => {
    // Unchanged and deliberate: the run carries the emptied line as a NEWLINE,
    // so there is no boundary left in the tree to host the node.
    const src = '::: |\na `b\n%% secret\nc\n:::\n'
    expect(JSON.stringify(content(src))).not.toContain('secret')
    expect(carveToCarve(src)).toBe('::: |\na `b\n%%\nc`\n:::\n')
  })

  it('CONTROL: the top-level shape is untouched, comment and breaks alike', () => {
    expect(content('::: |\na\n%% secret\nc\n:::\n')).toEqual([
      { type: 'text', value: 'a' },
      { type: 'hard_break' },
      { type: 'comment', block: false, content: 'secret' },
      { type: 'hard_break' },
      { type: 'text', value: 'c' },
    ])
  })

  it('CONTROL: a nested boundary keeps its SOFT spelling', () => {
    // carve-js#1127 ruled that a break inside a closed inline construct is not
    // hardened, and carve-php and carve-rs both produce this. Whether PART 9
    // §23 reaches that break is open on markup-carve/carve#1351; pinned here so a
    // change to it is a decision rather than a side effect of this pass.
    expect(content('::: |\n*a\nb\nc*\n:::\n')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', value: 'a' },
          { type: 'soft_break' },
          { type: 'text', value: 'b' },
          { type: 'soft_break' },
          { type: 'text', value: 'c' },
        ],
      },
    ])
  })
})
