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

  it('ends the list at a footnote definition', () => {
    expect(nested(' [^f]: x')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('ends the list at a link reference definition the same way', () => {
    expect(nested(' [r]: /u')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('folds an abbreviation definition the same way', () => {
    expect(nested(' *[A]: x')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n*[A]: x</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('ends the list exactly as the visible openers in that position do', () => {
    // The controls this rule is derived from: nothing distinguishes a
    // definition from these.
    const list = '<ul>\n  <li>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>\n'
    const opened: Record<string, string> = {
      ' # H': '<section id="H">\n  <h1>H</h1>\n</section>',
      ' > q': '<blockquote><p>q</p></blockquote>',
      ' :: t': '<dl>\n  <dt>t</dt>\n</dl>',
      ' | c |': '<table>\n  <tbody>\n    <tr><td>c</td></tr>\n  </tbody>\n</table>',
    }
    for (const lead of [' # H', ' > q', ' :: t', ' | c |']) {
      expect(nested(lead)).toBe(list + opened[lead])
    }
  })
})

describe('a definition that folded as text defines nothing', () => {
  it('resolves a reference', () => {
    // The half that made this two bugs: the line folded as text AND was
    // collected, so a reference elsewhere resolved against a line the renderer
    // prints verbatim.
    expect(carveToHtml('- - a\n [r]: /u\n\nsee [x][r]\n')).toContain('<p>see <a href="/u">x</a></p>')
  })

  it('defines a footnote', () => {
    expect(carveToHtml('- - a\n [^f]: x\n\nsee[^f]\n')).toContain('<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>')
  })

  it('does not expand an abbreviation', () => {
    expect(carveToHtml('- - a\n *[A]: x\n\nA here\n')).not.toContain('<abbr')
  })
})

describe('a definition AT a content column is still a definition', () => {
  it('resolves from an item content column', () => {
    expect(carveToHtml('- a\n  [r]: /u\n\nsee [x][r]\n')).toContain('<a href="/u">x</a>')
  })

  it('resolves when it IS the item, on the marker line', () => {
    // corpus 16-reference-link-4: stripping the marker leaves indent 0 against
    // a content column of 2, so a stripped-indent comparison would reject the
    // one shape that is at its content column by construction.
    expect(carveToHtml('- [ref]: /url\n\nSee [it][ref].\n')).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p>See <a href="/url">it</a>.</p>',
    )
  })

  it('resolves at document level', () => {
    expect(carveToHtml('[r]: /u\n\nsee [x][r]\n')).toContain('<a href="/u">x</a>')
  })

  it('still ends the item when the definition is FLUSH after it', () => {
    // Column 0 IS the document's content column, so there the definition opens
    // and the list ends - unchanged.
    expect(carveToHtml('- a\n[^f]: x\n')).toBe('<ul>\n  <li>a</li>\n</ul>')
  })
})
