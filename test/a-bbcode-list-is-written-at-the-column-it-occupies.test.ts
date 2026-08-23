import { describe, it, expect } from 'vitest'
import { bbcodeToCarve, carveToHtml } from '../src/index.js'

/**
 * `convertLists` was a pair of non-greedy regexes, and a regex can see neither
 * the closer that belongs to its opener nor the column its output will occupy.
 *
 * carve-js#1383 a list inside a quote wrote a blank line at column 0, which
 *   ends the quote, so one source quote came back as two blockquotes.
 * carve-js#1385 two adjacent `[list=1]` blocks merged into one `<ol>`: the
 *   bullet path alternates its marker to keep siblings apart and the ordered
 *   path spent no axis at all.
 * carve-js#1387 a nested list paired the outer opener with the INNER closer, so
 *   a literal `[list]` and a literal `[*]` reached the document as text; and an
 *   item's continuation paragraph was written flat, where the next marker line
 *   folded into it as lazy continuation.
 *
 * One stack scan settles all four, because all four are the same missing
 * knowledge: which closer this opener owns, and what column this line sits in.
 */
describe('a BBCode list is written at the column it occupies', () => {
  it('keeps a list inside the quote that holds it', () => {
    // carve-js#1383. The emitted Carve used to carry an unprefixed blank line
    // between the paragraph and the list, and a blank line at column 0 is where
    // the quote ends.
    const carve = bbcodeToCarve('[quote]\nintro text\n[list]\n[*]a\n[/list]\n[/quote]\n')

    expect(carve).toBe('> intro text\n>\n> - a\n')
    expect(carveToHtml(carve)).toBe(
      '<blockquote>\n  <p>intro text</p>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>',
    )
  })

  it('keeps two lists inside the one quote that holds them', () => {
    // The same input with a second list came back as FOUR blockquotes, one of
    // them empty.
    const carve = bbcodeToCarve(
      '[quote]\nintro text\n[list]\n[*]a\n[/list]\n[list]\n[*]b\n[/list]\n[/quote]\n',
    )

    expect(carve).toBe('> intro text\n>\n> - a\n>\n> * b\n')
    expect(carveToHtml(carve).match(/<blockquote>/g)).toHaveLength(1)
  })

  it('writes the quote marker at every depth the quote is nested to', () => {
    const carve = bbcodeToCarve('[quote][quote]\nintro\n[list]\n[*]a\n[/list]\n[/quote][/quote]\n')

    expect(carve).toBe('> > intro\n> >\n> > - a\n')
    expect(carveToHtml(carve).match(/<blockquote>/g)).toHaveLength(2)
  })

  it('gives the ordered path the delimiter axis the bullet path already had', () => {
    // carve-js#1385. `1. a` / blank / `1. b` is ONE list of two items in Carve,
    // so the second list lost its boundary and its restart together. PART 9
    // section 11 N1's other axis for an ordered list is the delimiter.
    const carve = bbcodeToCarve('[list=1]\n[*]a\n[/list]\n[list=1]\n[*]b\n[/list]\n')

    expect(carve).toBe('1. a\n\n1) b\n')
    expect(carveToHtml(carve)).toBe('<ol>\n  <li>a</li>\n</ol>\n<ol>\n  <li>b</li>\n</ol>')
  })

  it('keeps three adjacent ordered lists apart', () => {
    const carve = bbcodeToCarve(
      '[list=1]\n[*]a\n[/list]\n[list=1]\n[*]b\n[/list]\n[list=1]\n[*]c\n[/list]\n',
    )

    expect(carve).toBe('1. a\n\n1) b\n\n1. c\n')
    expect(carveToHtml(carve).match(/<ol>/g)).toHaveLength(3)
  })

  it('pairs a nested list with its own closer', () => {
    // carve-js#1387(a). The non-greedy pattern closed the OUTER list on the
    // INNER `[/list]`, so `outer two` fell outside every match and a valueless
    // `[list]` opener and a `[*]` - neither of which `cleanup` strips - reached
    // the document as text.
    const carve = bbcodeToCarve(
      '[list]\n[*]outer one\n[list]\n[*]inner\n[/list]\n[*]outer two\n[/list]\n',
    )

    expect(carve).toBe('- outer one\n  - inner\n- outer two\n')
    expect(carve).not.toContain('[list]')
    expect(carve).not.toContain('[*]')
    expect(carveToHtml(carve)).toBe(
      '<ul>\n  <li>outer one\n    <ul>\n      <li>inner</li>\n    </ul>\n  </li>\n  <li>outer two</li>\n</ul>',
    )
  })

  it('writes an item continuation at the item content column', () => {
    // carve-js#1387(b). Written flat, `second para` was a TOP-LEVEL paragraph
    // and `- second item` folded into it as lazy continuation, so a two-item
    // source list came back as one item plus a paragraph carrying the second
    // marker as text.
    const carve = bbcodeToCarve('[list]\n[*]first para\n\nsecond para\n[*]second item\n[/list]\n')

    expect(carve).toBe('- first para\n\n  second para\n- second item\n')
    expect(carveToHtml(carve)).toBe(
      '<ul>\n  <li><p>first para</p>\n    <p>second para</p>\n  </li>\n  <li><p>second item</p></li>\n</ul>',
    )
  })

  it('counts the separation axis per sibling group, not per document', () => {
    // THE BOUND ON THE AXIS. One counter for the whole document hands the same
    // marker to two adjacent siblings whenever a nested list consumed an index
    // between them - `- x` … `- z`, which is one list again. The counter
    // belongs to the group the lists are siblings IN.
    const carve = bbcodeToCarve(
      '[list]\n[*]x\n[list]\n[*]y\n[/list]\n[/list]\n[list]\n[*]z\n[/list]\n',
    )

    expect(carve).toBe('- x\n  - y\n\n* z\n')
    expect(carveToHtml(carve).match(/<ul>/g)).toHaveLength(3)
  })

  it('finishes an unclosed list at end of input', () => {
    // A CHANGE, not a bound: the regex needed a closer to match at all, so an
    // unclosed `[list]` came out as literal `[list]` and `[*]a` text. The stack
    // finishes it the way `convertQuotes` already finishes an unclosed quote.
    expect(bbcodeToCarve('[list]\n[*]a\n')).toBe('- a\n')
  })

  it('indents an ordered item continuation by the width of its own marker', () => {
    // A marker is not always two characters wide, and the content column is
    // where the marker ends.
    expect(bbcodeToCarve('[list=1]\n[*]a\n[list=1]\n[*]b\n[/list]\n[/list]\n')).toBe(
      '1. a\n   1. b\n',
    )
  })
})

describe('the list pass leaves alone what it is not writing into', () => {
  it('writes at column 0 when the tag follows prose rather than a container', () => {
    // THE BOUND ON THE COLUMN. The prefix is replicated only when what stands
    // before the tag on its line is container structure. A converter that
    // re-indented under any leading text would rewrite an ordinary post.
    // Byte for byte what the regex version wrote, trailing space included.
    expect(bbcodeToCarve('see this [list]\n[*]a\n[/list]\n')).toBe('see this \n\n- a\n')
  })

  it('converts an ordinary list exactly as before', () => {
    expect(bbcodeToCarve('[list]\n[*]one\n[*]two\n[/list]')).toBe('- one\n- two\n')
    expect(bbcodeToCarve('[list=1]\n[*]one\n[*]two\n[/list]')).toBe('1. one\n2. two\n')
    expect(bbcodeToCarve('[list]lead\n[*]x\n[/list]')).toBe('lead\n- x\n')
  })

  it('leaves a quote carrying no list exactly as before', () => {
    expect(bbcodeToCarve('[quote]\nline one\nline two\n[/quote]\n')).toBe('> line one\n> line two\n')
    expect(bbcodeToCarve('[quote=Alice]q[/quote]')).toBe('> q\n^ Alice\n')
  })

  it('claims no list spelling it did not claim before', () => {
    // `[list=a]` is not a form this converter has ever converted: the opener is
    // stripped by `cleanup` as an opener with a value, and the `[*]` stays.
    // Widening the set here would be a second change wearing this one's clothes.
    expect(bbcodeToCarve('[list=a]\n[*]x\n[/list]\n')).toBe('[*]x\n')
  })

  it('drops a stray closer exactly as before', () => {
    expect(bbcodeToCarve('a [/list] b\n')).toBe('a  b\n')
  })
})
