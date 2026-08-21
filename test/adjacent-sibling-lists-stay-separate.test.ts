import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse, toAstJson } from '../src/index.js'

const topTypes = (source: string): string[] =>
  ((toAstJson(parse(source)).children ?? []) as Array<{ type: string }>).map((c) => c.type)

/**
 * Two adjacent sibling lists written at the same column with matching markers
 * merge on re-parse, so `parse(fmt(x)) == parse(x)` is false for a document the
 * parser reads as two lists (carve#1088).
 *
 * carve#286 spent the marker axis - emit the marker as authored - which
 * separates them only while the markers DIFFER. When both are `1.` at column 0
 * there is nothing left to preserve.
 *
 * §11 N1a spells the separator: three blank lines. These used to assert a
 * cumulative one-space indent, which was what the writer had before the
 * boundary existed. That offset could not survive its own third list - the
 * second and third landed at the same column - and it handed the reader a list
 * indented by a space it never wrote.
 */
describe('adjacent sibling lists stay separate through fmt', () => {
  it('separates two ordered lists with the hard boundary', () => {
    const source = '1. a\n\n  1. b\n'
    expect(topTypes(source)).toEqual(['list', 'list'])
    expect(carveToCarve(source)).toBe('1. a\n\n\n\n1. b\n')
    expect(topTypes(carveToCarve(source))).toEqual(['list', 'list'])
  })

  it('separates a THIRD list the same way, at the same column', () => {
    // The offset this replaced could not do this: stepping +1 per list put the
    // second at one space and the third at two, where a bullet's content column
    // is 2 and the third would NEST inside the second.
    const source = '1. a\n\n  1. b\n\n   1. c\n'
    expect(topTypes(source)).toEqual(['list', 'list', 'list'])
    expect(carveToCarve(source)).toBe('1. a\n\n\n\n1. b\n\n\n\n1. c\n')
    expect(topTypes(carveToCarve(source))).toEqual(['list', 'list', 'list'])
  })

  it('writes the boundary at column 0, not as indentation', () => {
    // The reader gets the list back at the column the author wrote it.
    for (const line of carveToCarve('1. a\n\n  1. b\n').split('\n')) {
      expect(line).toBe(line.trimStart())
    }
  })

  it('is idempotent across repeated passes', () => {
    const once = carveToCarve('1. a\n\n  1. b\n\n   1. c\n')
    expect(carveToCarve(once)).toBe(once)
    expect(carveToCarve(carveToCarve(once))).toBe(once)
  })

  it('keeps the HTML unchanged', () => {
    const source = '1. a\n\n  1. b\n'
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })

  /**
   * BOUND, not proof: when the markers already differ the lists separate on
   * their own (carve#286), so no space is owed and none is added. Removing the
   * offset entirely leaves this passing - it is here so a fix cannot pass by
   * indenting every list that follows another one.
   */
  it('adds nothing when the bullet character already separates them', () => {
    const source = '- a\n\n * b\n'
    expect(topTypes(source)).toEqual(['list', 'list'])
    expect(carveToCarve(source)).toBe('- a\n\n* b\n')
    expect(topTypes(carveToCarve(source))).toEqual(['list', 'list'])
  })

  /**
   * BOUND: one list, and two lists with a paragraph between them, are both
   * untouched. Neither breaks under any mutation of the offset.
   */
  it('leaves a single list and a separated pair alone', () => {
    expect(carveToCarve('1. a\n1. b\n')).toBe('1. a\n2. b\n')
    expect(carveToCarve('1. a\n\nx\n\n1. b\n')).toBe('1. a\n\nx\n\n1. b\n')
  })
})

describe('§11 N1a: three blank lines are a hard list boundary', () => {
  it('one blank line still loosens', () => {
    expect(carveToHtml('- a\n\n- b\n')).toBe('<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>')
  })

  it('TWO blank lines still loosen rather than separate', () => {
    // The threshold is three precisely so the run documents already contain -
    // changelog spacing, generator output - keeps meaning what it meant.
    expect(carveToHtml('- a\n\n\n- b\n')).toBe('<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>')
  })

  it('three blank lines open a new sibling list', () => {
    expect(topTypes('- a\n\n\n\n- b\n')).toEqual(['list', 'list'])
  })

  it('so do four', () => {
    expect(topTypes('- a\n\n\n\n\n- b\n')).toEqual(['list', 'list'])
  })

  it('applies inside a quote', () => {
    expect(carveToHtml('> - a\n>\n>\n>\n> - b\n')).toContain('</ul>\n  <ul>')
  })

  it('applies to a list NESTED IN AN ITEM', () => {
    // The clause is stated for every level, and the nested case is the one that
    // pins it - a boundary that fired only at the top level would make one
    // spelling mean two things depending on where it sits.
    const html = carveToHtml('- outer\n\n  - a\n\n\n\n  - b\n')
    expect(html).toContain('</ul>\n    <ul>')
  })

  it('closes nothing on its own: a continuation still continues the item', () => {
    // The run denies a following SIBLING MARKER the right to join. It is not an
    // item terminator, so content at the content column belongs to the item.
    expect(topTypes('- a\n\n\n\n  still a\n')).toEqual(['list'])
  })

  it('a comment between two items separates them for its OWN reason', () => {
    // Recorded so the next reader does not mistake this for the threshold at
    // work: an invisible line between two items already opened a second list
    // before §11 N1a existed, and it still does. The threshold counts BLANK
    // lines only - `blankBeforeInvisible` is not added to the run - so this
    // shape is decided elsewhere and is unchanged by the rule.
    expect(topTypes('- a\n\n%% c\n\n- b\n')).toEqual(['list', 'comment', 'list'])
  })
})

describe('carve#1501: the writer spells two sibling sub-lists in a tight item', () => {
  const roundTrips = (source: string): boolean =>
    carveToHtml(carveToCarve(source)) === carveToHtml(source)

  it('keeps both sub-lists at the column the author wrote', () => {
    expect(carveToCarve('- o\n\n  - a\n\n\n\n  - b\n')).toBe('- o\n  - a\n\n\n\n  - b\n')
  })

  it('round-trips the nested boundary', () => {
    for (const source of [
      '- o\n\n  - a\n\n\n\n  - b\n',
      '- o\n\n  - a\n\n\n\n  - b\n\n\n\n  - c\n',
      '- o\n\n  1. a\n\n\n\n  1. b\n',
      '- o\n\n  - m\n\n    - a\n\n\n\n    - b\n',
      '- o\n\n  text\n\n  - a\n\n\n\n  - b\n',
      '- o\n\n  - a\n\n\n\n  - b\n\n\n\n- p\n',
    ]) {
      expect(roundTrips(source), source).toBe(true)
      expect(carveToCarve(carveToCarve(source)), source).toBe(carveToCarve(source))
    }
  })

  it('writes a blank line inside a quote as `>`, not as nothing', () => {
    // The boundary line carries the container's prefix by the time it expands,
    // and what it stands for is three blank lines IN THAT CONTEXT. Dropping the
    // prefix would end the quote instead of spacing inside it.
    const source = '> - o\n>\n>   - a\n>\n>\n>\n>   - b\n'
    expect(carveToCarve(source)).toBe('> - o\n>   - a\n>\n>\n>\n>   - b\n')
    expect(roundTrips(source)).toBe(true)
  })

  it('leaves the two-blank spelling alone', () => {
    expect(carveToCarve('- o\n\n  - a\n\n\n  - b\n')).toBe('- o\n  - a\n\n  - b\n')
  })
})

describe('a picked sentinel is never one of the reserved characters', () => {
  it('never hands out MARKER_COLUMN, whatever the document holds', () => {
    // U+E005 is MARKER_COLUMN and U+E000 is the nbsp marker. Handing either out
    // makes the writer read its own sentinel as the other thing: the §11 N1a
    // boundary was stripped by `line.startsWith(MARKER_COLUMN)` and came back as
    // an unindented blank line before this was reserved (carve#1501).
    let occupied = ''
    for (let cp = 0xe001; cp <= 0xe030; cp++) occupied += String.fromCharCode(cp)
    const source = `- o\n\n  - a\n\n\n\n  - b\n\n${occupied}\n`
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })
})
