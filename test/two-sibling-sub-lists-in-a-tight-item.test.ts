import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, toAstJson } from '../src/index.js'

/**
 * §11 N1a's boundary applies at EVERY level, so an item can hold two sibling
 * sub-lists - and the canonical writer could not spell one.
 *
 * A tight item joins its children so the re-parse stays tight, and where two of
 * them would merge it wrote both behind §17 L3's `+` marker at the item's MARKER
 * column. That column is column 0, which is where the list the item belongs to
 * writes its own markers: a sub-list put there is not attached to the item, it
 * is dissolved into the list around it. `- outer` / blank / `  - a` / three
 * blanks / `  - b` came back as one flat list of three items, with both
 * sub-lists and the boundary between them gone, so `toHtml(fmt(x)) ==
 * toHtml(x)` failed (markup-carve/carve#1501).
 *
 * The remedy is that a sub-list is written at the item's CONTENT column, with
 * whatever separator the block above it needs: the boundary when that block is a
 * list it would merge with, one blank line when it is a block that would read
 * the sub-list as its own continuation, and nothing at all otherwise.
 *
 * THE ASSERTIONS COMPARE RE-PARSES, not bytes of HTML with the escaping
 * forgiven: `shape` is the tree the reader gets back, and an equal-HTML check
 * alone is exactly what let the sibling defects in this area sit unnoticed.
 */

type AstNode = { type?: string; children?: AstNode[]; items?: AstNode[] }

/** The block tree as nested type names - `pos` and inline content dropped. */
const shape = (source: string): string => {
  const walk = (node: AstNode): string => {
    const kids = [...(node.items ?? []), ...(node.children ?? [])].filter(
      (kid) => kid.type === 'list' || kid.type === 'list_item' || kid.type === 'block_quote',
    )
    const inner = kids.map(walk).join(',')
    return inner.length > 0 ? `${node.type ?? '?'}(${inner})` : `${node.type ?? '?'}`
  }
  return walk(toAstJson(parse(source)) as AstNode)
}

/** Every property §1 asks of the writer, on one document. */
const roundTrips = (source: string): void => {
  const once = carveToCarve(source)
  expect(shape(once)).toBe(shape(source))
  expect(carveToHtml(once)).toBe(carveToHtml(source))
  expect(carveToCarve(once)).toBe(once)
}

/**
 * A line of nothing but spaces or tabs is not a form the writer may emit (PART
 * 11 §7), and it is what the first attempt at this fix produced above the second
 * list.
 */
const hasNoWhitespaceOnlyLine = (text: string): void => {
  for (const line of text.split('\n')) {
    if (line.length > 0) expect(line.trim().length).toBeGreaterThan(0)
  }
}

describe('two sibling sub-lists in a tight item', () => {
  it('writes the ticket document back as the author wrote it', () => {
    const source = '- outer\n\n  - a\n\n\n\n  - b\n'
    expect(shape(source)).toBe('document(list(list_item(list(list_item),list(list_item))))')
    expect(carveToCarve(source)).toBe('- outer\n  - a\n\n\n\n  - b\n')
    roundTrips(source)
  })

  it('does not put the sub-lists at the marker column', () => {
    // The failure was not "some other spelling": at column 0 the `- b` is an
    // item of the OUTER list, so the document loses a level of nesting.
    const written = carveToCarve('- outer\n\n  - a\n\n\n\n  - b\n')
    expect(written).not.toContain('\n+\n')
    expect(written.split('\n').filter((line) => line.startsWith('- '))).toEqual(['- outer'])
  })

  it('leaves no whitespace-only line above the second list', () => {
    hasNoWhitespaceOnlyLine(carveToCarve('- outer\n\n  - a\n\n\n\n  - b\n'))
  })

  it('spells the boundary as exactly three blank lines (§10i)', () => {
    expect(carveToCarve('- outer\n\n  - a\n\n\n\n  - b\n')).toContain('- a\n\n\n\n  - b')
  })

  it('collapses a longer run to three inside an item too (§10i)', () => {
    const six = '- outer\n\n  - a\n\n\n\n\n\n\n  - b\n'
    expect(carveToCarve(six)).toBe('- outer\n  - a\n\n\n\n  - b\n')
    roundTrips(six)
  })

  it('separates a third and a fourth sub-list the same way', () => {
    const three = '- outer\n\n  - a\n\n\n\n  - b\n\n\n\n  - c\n'
    expect(carveToCarve(three)).toBe('- outer\n  - a\n\n\n\n  - b\n\n\n\n  - c\n')
    roundTrips(three)
    roundTrips('- o\n\n  - a\n\n\n\n  - b\n\n\n\n  - c\n\n\n\n  - d\n')
  })

  it('separates sub-lists that hold more than one item', () => {
    roundTrips('- outer\n\n  - a\n  - a2\n\n\n\n  - b\n  - b2\n')
  })

  it('carries the boundary through ordered, bullet and task markers', () => {
    roundTrips('1. outer\n\n   1. a\n\n\n\n   1. b\n')
    roundTrips('1. outer\n\n   - a\n\n\n\n   - b\n')
    roundTrips('- outer\n\n  - [ ] a\n\n\n\n  - [ ] b\n')
  })

  it('separates sub-lists two levels down', () => {
    const source = '- L1\n\n  - L2\n\n    - a\n\n\n\n    - b\n'
    expect(carveToCarve(source)).toBe('- L1\n  - L2\n    - a\n\n\n\n    - b\n')
    roundTrips(source)
  })

  it('separates sub-lists in the second item of a list', () => {
    roundTrips('- one\n- two\n\n  - a\n\n\n\n  - b\n')
  })

  it('separates sub-lists below a fenced block in the same item', () => {
    roundTrips('- x\n\n  ```\n  c\n  ```\n\n  - a\n\n\n\n  - b\n')
  })

  it('separates sub-lists in a LOOSE item', () => {
    // The loose path is `renderBlocks`, which spliced the boundary BETWEEN two
    // rendered blocks. The splice hid the line break from the item's indent
    // pass, so `- b` came back at column 0 and left the item entirely.
    const source = '- outer\n\n  para\n\n  - a\n\n\n\n  - b\n'
    expect(carveToCarve(source)).toBe('- outer\n\n  para\n\n  - a\n\n\n\n  - b\n')
    roundTrips(source)
    roundTrips('- outer\n\n  - a\n\n\n\n  - b\n\n  tail\n')
  })

  it('spells the boundary with the host prefix inside a blockquote', () => {
    // A blockquote writes its own blank line as `>`, so the three blank lines
    // the boundary opens are `>` lines - an empty line would end the quote and
    // take the second list out of it.
    const source = '> - outer\n>\n>   - a\n>\n>\n>\n>   - b\n'
    expect(carveToCarve(source)).toBe('> - outer\n>   - a\n>\n>\n>\n>   - b\n')
    roundTrips(source)
  })

  it('spells the boundary with EVERY host prefix, however deep', () => {
    // The prefix is read off the line the tag opens, so no host has to know the
    // boundary exists - and a host that nests inside another gets both halves.
    // A nested quote writes `> >`, a quote inside a list item writes `  >`, and
    // a definition description writes nothing at its three-column indent.
    expect(carveToCarve('> > - a\n> >\n> >\n> >\n> > - b\n')).toBe(
      '> > - a\n> >\n> >\n> >\n> > - b\n',
    )
    roundTrips('> > - a\n> >\n> >\n> >\n> > - b\n')
    roundTrips('- x\n\n  > - a\n  >\n  >\n  >\n  > - b\n')
    roundTrips('- x\n\n  > - o\n  >\n  >   - a\n  >\n  >\n  >\n  >   - b\n')
    expect(carveToCarve(':: t\n:  - a\n\n\n\n   - b\n')).toBe(':: t\n:  - a\n\n\n\n   - b\n')
    roundTrips(':: t\n:  - a\n\n\n\n   - b\n')
  })

  it('keeps the top-level boundary exactly as it was', () => {
    // The control for the mechanism change: the boundary tag moved from a
    // splice between two blocks to the head of the second one, and at document
    // level nothing may move with it.
    expect(carveToCarve('- apples\n\n\n\n- oranges\n')).toBe('- apples\n\n\n\n- oranges\n')
    expect(carveToCarve('1. a\n\n  1. b\n')).toBe('1. a\n\n\n\n1. b\n')
  })
})

describe('a sub-list in a tight item gets the separator its neighbour needs', () => {
  it('writes one blank line below a block at the marker column', () => {
    // §17 L3 puts the attached paragraph at column 0, and a sub-list at the
    // item's content column below it is INDENTED under an open paragraph, so it
    // reads as that paragraph's lazy continuation and never opens.
    const source = '- x\n+\np2\n\n  - b\n'
    expect(carveToCarve(source)).toBe('- x\n+\np2\n\n  - b\n')
    roundTrips(source)
  })

  it('writes one blank line below a blockquote', () => {
    // A quote takes a non-blank line below it as lazy continuation, so the
    // sub-list became text inside the quote. This shape carries no boundary at
    // all - it failed on its own before #1501 and the same rule settles it.
    const source = '- x\n  > q\n\n  - b\n'
    expect(carveToCarve(source)).toBe('- x\n  > q\n\n  - b\n')
    roundTrips(source)
    roundTrips('- x\n\n  - a\n\n  > q\n\n  - b\n')
  })

  it('writes one blank line below a description', () => {
    roundTrips('- outer\n  - z\n\n  :: t\n  :  d\n\n  - s1\n')
  })

  it('writes one blank line below every kind that leaves a paragraph open', () => {
    // Each member of the set is load-bearing rather than carried along for
    // symmetry: with a sub-list already open at the item's content column, all
    // four of these lose the second sub-list without the blank line.
    for (const above of ['para', '![a](i.png)', '![a](i.png)\n  ^ cap', ':: t\n  :  d']) {
      roundTrips(`- o\n  - z\n  | t |\n  ${above}\n\n  - s1\n`)
    }
  })

  it('writes NO separator where nothing above reaches down', () => {
    // The bound on the rule: a heading, fence, table, break, div or admonition
    // closes at its last line, so the sub-list opens on the next one and owes
    // nothing. A blank line here would be a construct the document did not have.
    expect(carveToCarve('- x\n\n  # h\n\n  - b\n')).toBe('- x\n  # h\n  - b\n')
    expect(carveToCarve('- x\n\n  | a |\n\n  - b\n')).toBe('- x\n  | a |\n  - b\n')
    expect(carveToCarve('- x\n\n  ***\n\n  - b\n')).toBe('- x\n  ***\n  - b\n')
    expect(carveToCarve('- outer\n\n  - a\n')).toBe('- outer\n  - a\n')
  })

  it('leaves the marker column to the kinds that still need it', () => {
    // Two sibling blockquotes, tables, line blocks and definition lists merge
    // when written adjacent and CAN be attached at column 0, because none of
    // them opens there in preference to being attached. They keep the `+`.
    expect(carveToCarve('- outer\n\n  > a\n\n  > b\n')).toContain('\n+\n')
    expect(carveToCarve('- outer\n\n  | a |\n\n  | b |\n')).toContain('\n+\n')
    roundTrips('- outer\n\n  > a\n\n  > b\n')
    roundTrips('- outer\n\n  | a |\n\n  | b |\n')
  })

  it('owes nothing to sub-lists whose markers already differ', () => {
    // carve#286's axis: different markers separate on their own, so no
    // boundary is written and the author's adjacency survives.
    expect(carveToCarve('- outer\n\n  - a\n\n  * b\n')).toBe('- outer\n  - a\n  * b\n')
    roundTrips('- outer\n\n  - a\n\n\n\n  * b\n')
  })
})
