import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, toAstJson } from '../src/index.js'

/**
 * A COMMENT WRITTEN BELOW A SUB-LIST IN A TIGHT ITEM LANDED IN THE SUB-LIST.
 *
 * The item's content column IS the sub-list's marker column, and a `%%` line
 * there joins the sub-list's last item instead of opening a block of the
 * hosting item. So the writer's own output re-read one level deeper, and the
 * NEXT pass spelled the comment at the deeper column - `  %% q`, then
 * `    %% q`, and on down the nesting (markup-carve/carve-js#1676).
 *
 * NOTHING CAUGHT IT BECAUSE A COMMENT RENDERS NOTHING: the HTML is identical
 * across every pass, so `to_html(fmt(x)) == to_html(x)` holds throughout - the
 * property PART 11 §2a calls necessary and not sufficient. Only comparing the
 * written SOURCE of two passes, or the re-parsed tree, can see it.
 *
 * THE BOUND IS THE SIBLING ABOVE, and it is a sub-list alone. A comment below a
 * paragraph, a quote, a definition list or another comment already opens its own
 * block at the content column, and a `%%%` FENCE opener closes the sub-list on
 * its own - those spellings are unchanged, and the control rows below say so
 * with the exact source, so widening the rule fails loudly.
 */

/** The parsed tree with source positions dropped - what two passes must share. */
const treeOf = (source: string): string =>
  JSON.stringify(toAstJson(parse(source)), (key, value) =>
    key === 'pos' || key === 'srcByteLength' ? undefined : value,
  )

/** Every property PART 11 §1 asks of the writer, on one document. */
const roundTrips = (source: string): void => {
  const once = carveToCarve(source)
  expect(treeOf(once)).toBe(treeOf(source))
  expect(carveToHtml(once)).toBe(carveToHtml(source))
  // The pin: the SECOND pass, not the HTML. The drift was invisible to both of
  // the checks above once it had happened, because it moved a comment.
  expect(carveToCarve(once)).toBe(once)
}

/** Documents whose comment used to walk right one level per writer pass. */
const drifted: Array<[string, string]> = [
  ['the reported document', '- - d\n\n  %% q\na\n'],
  ['a bullet item hosting an ordered sub-list', '- 1. z\n\n  %% q\nZ\n'],
  ['an ordered item hosting a bullet sub-list', '1. - z\n\n   %% q\nZ\n'],
  ['two levels of sub-list below the comment', '- - - w\n\n  %% q\nZ\n'],
  ['a sub-list ending in an emptied item', '- - - +\n\n  %% q\nZ\n'],
  ['a sub-list whose last item ends in a quote', '- - > q\n\n  %% q\nZ\n'],
  ['a sub-list whose last item ends in a definition', '- - :: T\n    :  d\n\n  %% q\nZ\n'],
  ['the same item inside a blockquote', '> - - z\n>\n>   %% q\nZ\n'],
  ['the same item inside a div', '::: n\n- - z\n\n  %% q\n:::\nZ\n'],
]

describe('a comment below a sub-list in a tight item', () => {
  it('is written where a re-parse reads it back into the OUTER item', () => {
    const source = '- - d\n\n  %% q\na\n'
    expect(carveToCarve(source)).toBe('- - d\n\n  %% q\n\na\n')
    // The failing spelling, named so a regression cannot pass by accident.
    expect(carveToCarve(source)).not.toBe('- - d\n  %% q\n\na\n')
  })

  it('reaches a fixpoint on the reported document rather than walking right', () => {
    let written = carveToCarve('- - d\n\n  %% q\na\n')
    for (let pass = 0; pass < 4; pass++) {
      const next = carveToCarve(written)
      expect(next).toBe(written)
      written = next
    }
  })

  it.each(drifted)('round-trips: %s', (_name, source) => {
    roundTrips(source)
  })

  // The bound from above: these two were already correct, because nothing the
  // sub-list left open reaches down. They are here so a fix aimed at the column
  // rather than at the sibling above cannot quietly move them.
  it.each([
    ['a sub-list ending in a heading', '- - ## H\n\n  %% q\nZ\n'],
    ['a sub-list with one emptied item', '- - +\n\n  %% q\nZ\n'],
  ])('keeps round-tripping: %s', (_name, source) => {
    roundTrips(source)
  })

  // CONTROLS. Each asserts the EXACT source, because the point is that the
  // separator is NOT written here. A rule widened past "the sibling above is a
  // sub-list" gains a blank line in one of these and fails.
  it.each([
    ['at the top level, below a list', '- z\n\n%% q\nZ\n', '- z\n\n%% q\n\nZ\n'],
    ['below a paragraph in a single-level item', '- d\n\n  %% q\nZ\n', '- d\n  %% q\n\nZ\n'],
    ['below a quote', '- > q\n\n  %% q\nZ\n', '- > q\n  %% q\n\nZ\n'],
    ['below a definition list', '- t\n  : b\n\n  %% q\nZ\n', '- t\n  : b\n  %% q\n\nZ\n'],
    ['below another comment', '- %% c0\n\n  %% q\nZ\n', '- %% c0\n  %% q\n\nZ\n'],
    [
      'a comment FENCE below a sub-list',
      '- - z\n\n  %%%\n  body\n  %%%\nZ\n',
      '- - z\n  %%%\n  body\n  %%%\n\nZ\n',
    ],
  ])('writes no separator: %s', (_name, source, expected) => {
    expect(carveToCarve(source)).toBe(expected)
    roundTrips(source)
  })
})
