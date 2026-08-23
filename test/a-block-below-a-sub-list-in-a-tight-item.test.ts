import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, renderCarve, toAstJson } from '../src/index.js'

/**
 * A BLOCK WRITTEN BELOW A SUB-LIST IN A TIGHT ITEM LANDED IN THE SUB-LIST.
 *
 * §17 L3's `+` marker was written for a paragraph below a PARAGRAPH, and the
 * fold test asked exactly that: was the sibling above this one a `paragraph`?
 * Three other siblings leave a paragraph open below them, and a paragraph
 * written at the item's content column under any of them is read as its lazy
 * continuation instead of as a block of the item:
 *
 *   - a SUB-LIST, whose marker column IS the hosting item's content column, so
 *     the line is read against whatever its LAST item left open;
 *   - a BLOCKQUOTE, which takes any non-blank line below it;
 *   - a DEFINITION LIST, whose last description ends in a bare inline run.
 *
 * `- - x` / `  Z` came back as an inner item holding `x Z` - the outer item's
 * second block was gone and the reader saw one less level of content, with the
 * HTML plausible enough that only a tree comparison catches it.
 *
 * The remedy is the marker column the paragraph case already uses. The bound is
 * unchanged: a heading, fence, table, break or div closes at its last line and
 * owes the block under it nothing.
 *
 * Reported for the reverse Pandoc writer, which hands `renderCarve` a correct
 * tree and got source back that reads as a different one
 * (markup-carve/pandoc-carve#135).
 *
 * THE ASSERTIONS COMPARE RE-PARSED TREES, not rendered HTML alone: a tight list
 * cannot show a paragraph boundary in its HTML at all, so the shape is the only
 * thing that can tell the two trees apart.
 */

type AstNode = { type?: string; children?: AstNode[]; items?: AstNode[] }

/** The block tree as nested type names - `pos` and inline content dropped. */
const shape = (node: AstNode): string => {
  const kids = [...(node.items ?? []), ...(node.children ?? [])].filter(
    (kid) =>
      kid.type === 'list' ||
      kid.type === 'list_item' ||
      kid.type === 'block_quote' ||
      kid.type === 'paragraph' ||
      kid.type === 'definition_list',
  )
  const inner = kids.map(shape).join(',')
  return inner.length > 0 ? `${node.type ?? '?'}(${inner})` : `${node.type ?? '?'}`
}

const shapeOf = (source: string): string => shape(toAstJson(parse(source)) as AstNode)

/** Every property PART 11 §1 asks of the writer, on one document. */
const roundTrips = (source: string): void => {
  const once = carveToCarve(source)
  expect(shapeOf(once)).toBe(shapeOf(source))
  expect(carveToHtml(once)).toBe(carveToHtml(source))
  expect(carveToCarve(once)).toBe(once)
}

describe('a paragraph below a sub-list in a tight item', () => {
  it('stays in the OUTER item', () => {
    // The reported shape, written with a construct that survives on its own so
    // the case does not also depend on a hoisted definition.
    const source = '- - x\n+\n:\n'
    expect(shapeOf(source)).toBe(
      'document(list(list_item(list(list_item(paragraph)),paragraph)))',
    )
    expect(carveToCarve(source)).toBe('- - x\n+\n:\n')
    roundTrips(source)
  })

  it('is written at the marker column, not at the item content column', () => {
    // The failure was not another spelling of the same document: indented into
    // the item, the line joins the sub-list's last item.
    const written = carveToCarve('- - x\n+\n:\n')
    expect(written).toContain('\n+\n')
    expect(written).not.toBe('- - x\n  :\n')
  })

  it('does not fold when the sub-list ends in a quote two levels down', () => {
    roundTrips('- - > q\n+\nZ\n')
  })

  it('does not fold below a quote or a definition list either', () => {
    roundTrips('- > q\n+\nZ\n')
    roundTrips('- :: T\n  :  d\n+\nZ\n')
  })

  it('needs no marker when the sub-list\'s last item is empty', () => {
    // Nothing is open below an emptied item, so the marker would cost a
    // construct the document did not have. This is why the rule recurses into
    // the last item instead of treating every sub-list as reaching down.
    expect(carveToCarve('- - +\n  Z\n')).toBe('- - +\n  Z\n')
    roundTrips('- - +\n  Z\n')
  })

  it('keeps a resumed line at the OUTER column with two levels of nesting', () => {
    // The deeper case, and the one an off-by-one fix would still get wrong: two
    // resumed lines at two different columns, one for the middle item and one
    // for the outer. Written at their content columns, both fold into the
    // middle item and the outer item loses its paragraph.
    const source = '- - - +\n    mid\n+\nout\n'
    expect(shapeOf(source)).toBe(
      'document(list(list_item(list(list_item(list(list_item),paragraph)),paragraph)))',
    )
    expect(carveToCarve(source)).toBe('- - - +\n    mid\n+\nout\n')
    roundTrips(source)
  })

  it('writes NO marker where nothing above reaches down', () => {
    // The bound on the rule. Each of these closes at its last line, so the
    // paragraph below opens on the next one and a marker would be noise.
    expect(carveToCarve('- ## H\n  Z\n')).toBe('- ## H\n  Z\n')
    expect(carveToCarve('- | a |\n  Z\n')).toBe('- | a |\n  Z\n')
    expect(carveToCarve('- ***\n  Z\n')).toBe('- ***\n  Z\n')
  })

  it('asks the CONTAINER what it ends in, rather than naming its kind', () => {
    // A quote is not a reason on its own account. One ending in a block that
    // closes at its last line reaches nothing below it, and the writer already
    // spelled these correctly - a blanket `true` for every quote would cost each
    // of them a `+` the document never had.
    for (const source of ['- > ## H\n  Z\n', '- > | a |\n  Z\n', '- > ***\n  Z\n']) {
      expect(carveToCarve(source)).toBe(source)
      roundTrips(source)
    }
  })

  it('holds for a tree built by hand, with no source positions at all', () => {
    // How the defect was reported: the Pandoc bridge builds the tree directly,
    // so nothing in it carries a `pos` and no hoisted definition can be written
    // back into the line it came from. The writer has to reach the right
    // spelling from the tree alone.
    const paragraph = (text: string) => ({
      type: 'paragraph' as const,
      children: [{ type: 'text' as const, value: text }],
    })
    const item = (children: unknown[]) => ({ type: 'list_item' as const, children })
    const list = (items: unknown[]) => ({
      type: 'list' as const,
      ordered: false,
      tight: true,
      items,
    })
    const document = {
      type: 'document' as const,
      children: [list([item([list([item([])]), paragraph(':')])])],
    }
    const written = renderCarve(document as unknown as Parameters<typeof renderCarve>[0])
    expect(shapeOf(written)).toBe(
      'document(list(list_item(list(list_item),paragraph)))',
    )
    expect(carveToHtml(written)).toBe(carveToHtml('* * [d]: u\n  :\n'))
  })
})
