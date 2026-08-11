import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * PART 1 S4 (carve-js#597): a definition line BELOW every content column is
 * lazy text, the same as any other opener there.
 *
 * A construct opens only AT its container's content column. One column in,
 * ` [^f]: x` reaches neither the sub-list's content column nor the outer item's,
 * so it opens nothing - and with the sub-item's paragraph open, S4 folds it in.
 * Nothing distinguishes a definition from the heading, quote, table row, colon
 * fence or bullet in that position, and those already folded.
 *
 * The footnote and link forms used to end the list and reappear as a document
 * paragraph. Both went through RE_LINK_DEF, which is whitespace-tolerant on
 * purpose (other passes need it to see a quoted or nested def) and whose leading
 * class is "whitespace except NBSP" - so it matched a leading SPACE where every
 * other predicate's anchor rejected one. `[^f]: x` has the link-def shape too,
 * which is why the flush-anchored footnote pattern never had to match for the
 * footnote case to break.
 */
describe('a definition one column in folds as text', () => {
  const nested = (line: string) => carveToHtml(`- - a\n${line}\n`)

  it('folds a footnote definition into the open paragraph', () => {
    expect(nested(' [^f]: x')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n[^f]: x</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('folds a link reference definition the same way', () => {
    expect(nested(' [r]: /u')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n[r]: /u</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('folds an abbreviation definition the same way', () => {
    expect(nested(' *[A]: x')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n*[A]: x</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('folds exactly as the visible openers in that position already did', () => {
    // The controls this rule is derived from: nothing distinguishes a
    // definition from these.
    for (const lead of [' # H', ' > q', ' :: t', ' | c |']) {
      expect(nested(lead)).toContain('<li>a\n')
      expect(nested(lead)).not.toContain('</ul>\n<p>')
    }
  })
})

describe('a definition that folded as text defines nothing', () => {
  it('does not resolve a reference', () => {
    // The half that made this two bugs: the line folded as text AND was
    // collected, so a reference elsewhere resolved against a line the renderer
    // prints verbatim.
    expect(carveToHtml("- - a\n    [r]: /u\n\nsee [x][r]\n")).toContain('<p>see [x][r]</p>')
  })

  it('does not define a footnote', () => {
    expect(carveToHtml("- - a\n    [^f]: x\n\nsee[^f]\n")).toContain('<p>see[^f]</p>')
  })

  it('does not expand an abbreviation', () => {
    expect(carveToHtml("- - a\n    *[A]: x\n\nA here\n")).not.toContain('<abbr')
  })
})

describe('a definition AT a content column is still a definition', () => {
  it('resolves from an item content column', () => {
    expect(carveToHtml("- a\n\nsee [x][r]\n\n[r]: /u\n")).toContain('<a href="/u">x</a>')
  })

  it('resolves when it IS the item, on the marker line', () => {
    // corpus 16-reference-link-4: stripping the marker leaves indent 0 against
    // a content column of 2, so a stripped-indent comparison would reject the
    // one shape that is at its content column by construction.
    expect(carveToHtml("- +\n\nSee [it][ref].\n\n[ref]: /url\n")).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p>See <a href="/url">it</a>.</p>',
    )
  })

  it('resolves at document level', () => {
    expect(carveToHtml("see [x][r]\n\n[r]: /u\n")).toContain('<a href="/u">x</a>')
  })

  it('still ends the item when the definition is FLUSH after it', () => {
    // Column 0 IS the document's content column, so there the definition opens
    // and the list ends - unchanged.
    expect(carveToHtml("- a\n\n[^f]: x\n")).toBe('<ul>\n  <li>a</li>\n</ul>')
  })
})
