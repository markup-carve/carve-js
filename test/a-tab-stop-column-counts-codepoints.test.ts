import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

/**
 * A tab stop is reached in CODEPOINTS, not UTF-16 code units (carve#2354).
 *
 * PART 12 section 4 makes a column a count of Unicode codepoints and rejects
 * bytes and UTF-16 by name. Everything in the Basic Multilingual Plane counts
 * the same under all three units, so only an astral character discriminates:
 * one codepoint, two UTF-16 code units, four UTF-8 bytes. A suite without one
 * cannot see the difference, which is why this engine advanced the tab stop by
 * two for an emoji for as long as it did.
 *
 * The line block is where a tab's column reaches an observable node: the
 * columns a tab owes become `non_breaking_space` children, so counting them
 * measures the walk directly.
 */
describe('a tab stop column counts codepoints', () => {
  const nodes = (value: unknown): any[] =>
    !value || typeof value !== 'object'
      ? []
      : [value, ...Object.entries(value).filter(([key]) => key !== 'pos')
          .flatMap(([, child]) => nodes(child))]

  const stanza = (before: string, tabs = 1): string =>
    `::: |\n${before}${'\t'.repeat(tabs)}x\n:::\n`

  const generatedColumns = (source: string): number =>
    nodes(parse(source)).filter((node) => node.type === 'non_breaking_space').length

  // before the tab -> codepoints, UTF-16 code units, the columns the tab owes.
  // The last row of each pair is what a UTF-16 walk would answer; it differs
  // only where a surrogate pair is involved, so a regression stays legible.
  for (const [label, before, codepoints, units, columns, utf16Columns] of [
    ['one ASCII letter', 'a', 1, 1, 3, 3],
    ['two ASCII letters', 'ab', 2, 2, 2, 2],
    ['U+00E9, two UTF-8 bytes', 'é', 1, 1, 3, 3],
    ['U+20AC, three UTF-8 bytes', '€', 1, 1, 3, 3],
    ['U+1F600, one surrogate pair', '\u{1F600}', 1, 2, 3, 2],
    ['two surrogate pairs', '\u{1F600}\u{1F600}', 2, 4, 2, 4],
    ['e plus U+0301, two codepoints in one grapheme', 'é', 2, 2, 2, 2],
  ] as Array<[string, string, number, number, number, number]>) {
    it(`owes ${columns} columns after ${label}`, () => {
      expect([...before]).toHaveLength(codepoints)
      expect(before).toHaveLength(units)
      expect(generatedColumns(stanza(before))).toBe(columns)
      if (utf16Columns !== columns) {
        expect(generatedColumns(stanza(before))).not.toBe(utf16Columns)
      }
    })
  }

  it('reaches the second stop from a codepoint column too', () => {
    // Two tabs compound the error, so a single wrong stop cannot hide behind a
    // count that happens to match: 1 + 3 + 4 columns, not 2 + 2 + 4.
    expect(generatedColumns(stanza('\u{1F600}', 2))).toBe(7)
  })

  it('omits a one-column tab at an astral column, as carve#2349 permits', () => {
    // The permitted omission, pinned at the boundary the fix moves: three
    // codepoints reach column 3, the tab owes one column, and a single owed
    // column stays an ordinary space that merges the text. Counted in UTF-16
    // the same line reaches column 6 and owes two, which would generate them.
    const all = nodes(parse(stanza('\u{1F600}\u{1F600}\u{1F600}')))
    expect(all.filter((node) => node.type === 'non_breaking_space')).toHaveLength(0)
    expect(all.find((node) => node.type === 'text')?.value).toBe('\u{1F600}\u{1F600}\u{1F600} x')
  })

  it('omits a one-column tab in pure ASCII as well', () => {
    // The control for the row above: same omission, no astral character, so a
    // failure here is about the omission and not about the unit.
    const all = nodes(parse(stanza('abc')))
    expect(all.filter((node) => node.type === 'non_breaking_space')).toHaveLength(0)
    expect(all.find((node) => node.type === 'text')?.value).toBe('abc x')
  })

  it('leaves the surviving spans addressing their own source', () => {
    // The offsets the walk records stay per UTF-16 code unit on purpose - the
    // remap indexes them that way - so changing the column must not shift the
    // codepoint positions the AST publishes.
    const source = stanza('\u{1F600}')
    const all = nodes(parse(source))
    for (const node of all.filter((node) => node.type === 'text')) {
      expect(node.pos).toBeDefined()
      expect([...source].slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(node.value)
    }
    const emoji = all.find((node) => node.type === 'text' && node.value === '\u{1F600}')
    expect(emoji.pos.startColumn).toBe(1)
    expect(emoji.pos.endColumn).toBe(2)
  })
})
