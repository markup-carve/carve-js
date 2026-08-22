import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, toAstJson } from '../src/index.js'

/*
 * A list item continued with a TAB keeps every position inside it.
 *
 * The item's body is re-parsed from a snippet dedented to the item's content
 * column, and the sub-lexer is anchored back to the document by matching each
 * dedented line against its source line. Dedenting past a tab that STRADDLES
 * the content column re-emits the unconsumed columns as spaces, so the line is
 * no longer a literal suffix of its source and the anchor is computed from the
 * synthetic run instead.
 *
 * That arithmetic goes NEGATIVE whenever the synthetic run is wider than the
 * characters it replaced - `- item` has content column 2, so a `<TAB>more`
 * continuation dedents to `<SP><SP>more`, two synthetic spaces standing in for
 * one source character. It was rejected as impossible, and every position
 * inside the item went with it: the paragraph and all three of its inlines
 * (markup-carve/carve-js#814).
 *
 * The HTML is byte-identical either way, which is why no corpus document could
 * see this: the whole divergence is in PART 12 positions.
 */

/** Every `[type, startOffset, endOffset]` in the tree, in document order. */
const spans = (source: string): Array<[string, number | null, number | null]> => {
  const out: Array<[string, number | null, number | null]> = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    const type = record['type']
    if (typeof type === 'string') {
      const pos = record['pos'] as { startOffset?: number; endOffset?: number } | undefined
      out.push([type, pos?.startOffset ?? null, pos?.endOffset ?? null])
    }
    for (const [key, value] of Object.entries(record)) {
      if (key === 'pos') continue
      walk(value)
    }
  }
  walk(toAstJson(parse(source)))
  return out
}

/** The source each span selects, so the assertion reads as text, not numbers. */
const slices = (source: string) =>
  spans(source).map(([type, from, to]) =>
    from === null || to === null ? [type, null] : [type, source.slice(from, to)],
  )

describe('a tab continues a list item just as two spaces do', () => {
  // A bullet's content column is 2, so a leading tab straddles it. Widened past
  // the `-` the ticket names: `*` is the other bullet character and a task
  // marker is a bullet too, and both were broken the same way.
  const bullets: Array<[string, string]> = [
    ['dash', '- item\n\tmore\n\nx\n'],
    ['star', '* item\n\tmore\n\nx\n'],
    ['task', '- [ ] item\n\tmore\n\nx\n'],
  ]

  for (const [label, source] of bullets) {
    it(`places the paragraph and all three inlines: ${label}`, () => {
      const inside = slices(source).filter(([type]) =>
        ['paragraph', 'text', 'soft_break'].includes(type as string),
      )

      expect(inside.some(([, text]) => text === null)).toBe(false)
    })
  }

  it('publishes exactly the spans carve-rs and carve-php publish', () => {
    // The ticket's own table, asserted as source slices. The soft break covers
    // the newline AND the tab, which is what makes the following text start at
    // the tab's single source character rather than at the two columns it
    // reaches.
    //
    // THE LIST NO LONGER CARRIES THE TRAILING NEWLINE. It read
    // `'- item\n\tmore\n'` while its only item read `'- item\n\tmore'`, and the
    // difference was the line terminator that ended the item - source no child
    // of the list owns, which PART 12 §4 excludes and markup-carve/carve#1522
    // ruled the list must stop before. Everything the test was written for is
    // unchanged: the tab arithmetic, the soft break's two characters, and the
    // item's own extent.
    expect(slices('- item\n\tmore\n\nx\n')).toEqual([
      ['document', null],
      ['list', '- item\n\tmore'],
      ['list_item', '- item\n\tmore'],
      ['paragraph', 'item\n\tmore'],
      ['text', 'item'],
      ['soft_break', '\n\t'],
      ['text', 'more'],
      ['paragraph', 'x'],
      ['text', 'x'],
    ])
  })

  it('counts the tab as one character, not as the columns it reaches', () => {
    // The tab advances to column 4 and the content column is 2, so a fix that
    // charged the item two source characters for it would put `more` at offset
    // 9 - where the two-space spelling has it - and slice to `ore`.
    const source = '- item\n\tmore\n\nx\n'
    const [, from, to] = spans(source).filter(([type]) => type === 'text')[1]!

    expect(source.slice(from!, to!)).toBe('more')
    expect(from).toBe(8)
  })

  it('places a mixed indentation run in both orders', () => {
    // `<SP><TAB>` never straddled - the space consumes one column and the tab
    // then starts at column 2 and reaches 4, leaving the same two synthetic
    // columns but two source characters to charge them to. `<TAB><SP>` did
    // straddle and was broken. Both are here because a fix aimed at the run
    // could easily answer only one of them.
    expect(slices('- item\n \tmore\n\nx\n').at(-1)).toEqual(['text', 'x'])
    expect(slices('- item\n\t more\n\nx\n').filter(([t]) => t === 'text')).toEqual([
      ['text', 'item'],
      ['text', 'more'],
      ['text', 'x'],
    ])
  })

  it('places a nested item, which published a WRONG span rather than none', () => {
    // The worse half of the same defect. The inner list and item published no
    // position, and the inner paragraph published `[0,10]` - a span in the
    // SUB-LEXER's coordinates presented as a document one, slicing to
    // `- a\n  - ite`. PART 12 §4 forbids inventing a value, and absence at least
    // says so; this said something false.
    const source = '- a\n  - item\n\t\tmore\n\nx\n'
    const inner = slices(source).slice(5)

    expect(inner).toEqual([
      ['list', '- item\n\t\tmore'],
      ['list_item', '- item\n\t\tmore'],
      ['paragraph', 'item\n\t\tmore'],
      ['text', 'item'],
      ['soft_break', '\n\t\t'],
      ['text', 'more'],
      ['paragraph', 'x'],
      ['text', 'x'],
    ])
  })

  it('CONTROL: two spaces instead of the tab, unchanged', () => {
    // The list's trailing newline went here for the reason it went above: it is
    // the item's line terminator and belongs to no child (carve#1522). The
    // control's own point - that spaces and a tab produce the same spans - is
    // what it was.
    expect(slices('- item\n  more\n\nx\n')).toEqual([
      ['document', null],
      ['list', '- item\n  more'],
      ['list_item', '- item\n  more'],
      ['paragraph', 'item\n  more'],
      ['text', 'item'],
      ['soft_break', '\n  '],
      ['text', 'more'],
      ['paragraph', 'x'],
      ['text', 'x'],
    ])
  })

  it('CONTROL: an ordered marker with the same tab continuation, unchanged', () => {
    // Its content column is 3, so the tab reaches column 4 and leaves ONE
    // synthetic column against two source characters - the arithmetic never
    // went negative and this always worked. No mutation of this change can move
    // it; it is here because it is what made the defect look like it was about
    // bullets rather than about tab width.
    expect(slices('1. item\n\tmore\n\nx\n').filter(([t]) => t === 'text')).toEqual([
      ['text', 'item'],
      ['text', 'more'],
      ['text', 'x'],
    ])
  })

  it('CONTROL: the HTML is identical with a tab and with two spaces', () => {
    // The reason no corpus document could ever have caught this.
    expect(carveToHtml('- item\n\tmore\n\nx\n')).toBe(carveToHtml('- item\n  more\n\nx\n'))
  })
})
