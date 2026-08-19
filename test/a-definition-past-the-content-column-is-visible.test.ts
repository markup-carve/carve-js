import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

const listTight = (source: string): boolean | undefined => {
  const children = (toAstJson(parse(source)).children ?? []) as Array<Record<string, unknown>>
  return children.find((child) => child.type === 'list')?.tight as boolean | undefined
}

/**
 * A reference or footnote definition is COLLECTED only at the container's
 * content column. One column further in it is not a definition at all - it
 * renders as ordinary text - so it must count as the second paragraph that
 * loosens the item.
 *
 * Two places tested the shape with the indent ignored: `isInvisibleLine` skipped
 * the line as rendering nothing, and `lineOpensBlock` called it a block opener.
 * Either one alone keeps the item tight. carve-php and carve-rs both leave it
 * loose.
 */
describe('a definition past the content column is visible', () => {
  it.each([
    ['a reference definition', '1. item\n\n    [r]: /u\n'],
    ['a footnote definition', '1. item\n\n    [^f]: n\n'],
  ])('%s loosens the item', (_name, source) => {
    expect(listTight(source)).toBe(false)
  })

  /**
   * The abbreviation shape already behaved: it is never recognized inside a
   * container at any column, so it was always visible. Both mutations leave
   * this passing, so it bounds the change rather than proving it.
   */
  it('an abbreviation definition is unchanged', () => {
    expect(listTight('1. item\n\n    *[AB]: x\n')).toBe(false)
  })

  /**
   * The other bound, and the one that matters most: AT the content column the
   * definition IS collected, the item then holds a single block, and tight is
   * the correct answer. A fix that simply stopped treating definitions as
   * invisible would break this row.
   */
  it.each([
    ['a reference definition', '1. item\n\n   [r]: /u\n'],
    ['a footnote definition', '1. item\n\n   [^f]: n\n'],
    ['a line comment', '1. item\n\n   %% c\n'],
  ])('%s at the content column keeps the item tight', (_name, source) => {
    expect(listTight(source)).toBe(true)
  })

  it('the reference still resolves when it is at the content column', () => {
    expect(listTight('1. item\n\n   [r]: /u\n')).toBe(true)
  })
})
