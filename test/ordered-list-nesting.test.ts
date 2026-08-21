import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

/**
 * An ordered sub-list indented to the parent item's content column must nest,
 * matching carve-php / carve-rs. Ordered markers do not interrupt a paragraph
 * (§10), so the sub-list used to fold into the lead paragraph as literal text
 * (`<li>a\n1. b</li>`) instead of nesting.
 */
describe('ordered sub-list nesting', () => {
  it('nests an ordered sub-list at the content column', () => {
    expect(html('1. a\n   1. b')).toBe(
      '<ol>\n  <li>a\n    <ol>\n      <li>b</li>\n    </ol>\n  </li>\n</ol>',
    )
  })

  it('nests several ordered levels', () => {
    expect(html('1. a\n   1. b\n      1. c')).toBe(
      '<ol>\n  <li>a\n    <ol>\n      <li>b\n        <ol>\n          <li>c</li>\n        </ol>\n      </li>\n    </ol>\n  </li>\n</ol>',
    )
  })

  it('an ordered marker still does not interrupt a paragraph (§10)', () => {
    // A non-indented ordered marker after paragraph text stays inline (§10).
    expect(html('text here\n1. b')).toBe('<p>text here\n1. b</p>')
  })

  it('nests an unordered sub-list under an ordered item', () => {
    expect(html('1. a\n   - b')).toBe(
      '<ol>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ol>',
    )
  })
})

describe('ordered list indentation (Model A: content column)', () => {
  const h = (s: string) => carveToHtml(s).trim()

  it('detaches a two-space sublist below an ordered item content column (col 2 < 3)', () => {
    // Content-column model: after a blank the same content-column rule applies
    // as without a blank. `1. `'s content column is 3; a sublist at column 2 is
    // below it, so the item body ends and the sublist parses at document level.
    expect(h('1. one\n\n  - sub a\n  - sub b\n\n1. two\n')).toBe(
      '<ol>\n' +
        '  <li>one</li>\n' +
        '</ol>\n' +
        '<ul>\n' +
        '  <li>sub a</li>\n' +
        '  <li>sub b</li>\n' +
        '</ul>\n' +
        '<ol>\n' +
        '  <li>two</li>\n' +
        '</ol>',
    )
  })

  it('detaches a two-space paragraph below an ordered item content column (col 2 < 3)', () => {
    expect(h('1. one\n\n  para\n\n1. two\n')).toBe(
      '<ol>\n' +
        '  <li>one</li>\n' +
        '</ol>\n' +
        '<p>para</p>\n' +
        '<ol>\n' +
        '  <li>two</li>\n' +
        '</ol>',
    )
  })

  it('folds an ordered child BELOW the content column (no blank, §10)', () => {
    // `  1. b` is at column 2, below `1. `'s content column (3); ordered does
    // not interrupt a paragraph, so it is lazy continuation, not a sub-list.
    expect(h('1. a\n  1. b')).toBe('<ol>\n  <li>a\n1. b</li>\n</ol>')
  })

  it('nests an ordered child AT the content column', () => {
    expect(h('1. a\n   1. b')).toBe(
      '<ol>\n  <li>a\n    <ol>\n      <li>b</li>\n    </ol>\n  </li>\n</ol>',
    )
  })

  it('an ordered dialect change at the base column still starts a new list (§11)', () => {
    expect(h('1. a\nb. c')).toBe(
      '<ol>\n  <li>a</li>\n</ol>\n<ol type="a" start="2">\n  <li>c</li>\n</ol>',
    )
  })
})

describe('task list content column (the bullet, not the checkbox)', () => {
  const h = (s: string) => carveToHtml(s).trim()

  it('nests a child indented to the bullet column (2), not the checkbox column', () => {
    expect(h('- [ ] a\n  - b')).toBe(
      '<ul>\n  <li><input type="checkbox" disabled aria-label="a"> a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})

describe('list indentation: tab stops and below-content-column nesting', () => {
  const h = (s: string) => carveToHtml(s).trim()
  const nestedUl =
    '<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>'
  const nestedOl =
    '<ol>\n  <li>a\n    <ol>\n      <li>b</li>\n    </ol>\n  </li>\n</ol>'

  it('folds an unordered child below the content column (one space, no interrupt)', () => {
    // `- b` at column 1 is below `- `'s content column (2); a bullet no longer
    // interrupts, so it folds into the lead text as lazy continuation.
    expect(h('- a\n - b')).toBe('<ul>\n  <li>a\n- b</li>\n</ul>')
  })

  it('still nests an unordered child at the content column (two spaces)', () => {
    expect(h('- a\n  - b')).toBe(nestedUl)
  })

  it('nests a tab-indented ordered child (tab stop column 4 >= content column 3)', () => {
    expect(h('1. a\n\t1. b')).toBe(nestedOl)
  })

  it('nests a tab-indented unordered child (interrupts at any indent past base)', () => {
    expect(h('- a\n\t- b')).toBe(nestedUl)
  })

  it('still folds an ordered child below the content column (two spaces, no §10 interrupt)', () => {
    expect(h('1. a\n  1. b')).toBe('<ol>\n  <li>a\n1. b</li>\n</ol>')
  })

  it('keeps the spec tight two-space ordered marker fold unchanged', () => {
    expect(h('1. outer\n  1. inner\n')).toBe('<ol>\n  <li>outer\n1. inner</li>\n</ol>')
  })

  it('detaches below a wide ordered marker content column after a blank (col 2 < 4)', () => {
    // `10. `'s content column is 4; a two-space continuation is below it, so the
    // content-column model ends the item and the paragraph parses at document
    // level (no `baseIndent + 2` relaxation).
    expect(h('10. one\n\n  para\n\n11. two\n')).toBe(
      '<ol start="10">\n' +
        '  <li>one</li>\n' +
        '</ol>\n' +
        '<p>para</p>\n' +
        '<ol start="11">\n' +
        '  <li>two</li>\n' +
        '</ol>',
    )
  })

  it('keeps a base-column ordered dialect change as a new list (§11)', () => {
    expect(h('1. a\nb. c')).toBe(
      '<ol>\n  <li>a</li>\n</ol>\n<ol type="a" start="2">\n  <li>c</li>\n</ol>',
    )
  })

  it('treats two equally tab-indented markers as siblings, not parent/child', () => {
    // The marker line itself carries a tab, so the content column must be
    // measured in visual columns; otherwise the second item (same base column)
    // would be misread as nested content of the first.
    expect(h('\t- a\n\t- b')).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')
  })
})

describe('mixed tab+space aligned sub-items are siblings (visual columns)', () => {
  const h = (s: string) => carveToHtml(s).trim()

  it('aligns ordered sub-items at the same visual column as siblings', () => {
    // `\t  1. b` (tab to col 4, +2 = col 6) and `      2. c` (6 spaces) sit at the
    // same visual column, so they are siblings, not parent/child. A sub-list block
    // stream is dedented residual-aware, so the partially-consumed tab leaves the
    // two markers at an equal column and the sub-list re-derives its base from
    // visual columns (matches carve-php).
    expect(h('1. a\n\t  1. b\n      2. c')).toBe(
      '<ol>\n  <li>a\n    <ol>\n      <li>b</li>\n      <li>c</li>\n    </ol>\n  </li>\n</ol>',
    )
  })

  it('aligns unordered sub-items the same way', () => {
    expect(h('- a\n\t  - b\n      - c')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n      <li>c</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('reads a tab-indented block opener as the column it reaches, not as flush', () => {
    // `1. ` claims columns 0-2, so the content column is 3 and a tab reaches
    // column 4 - one column PAST it. The space spellings settle what that
    // means and all three engines agree on them: at the content column the
    // quote nests, one column past it is text.
    //
    // This used to assert the opposite, because a lead block was dedented
    // whole-tab and the opener arrived flush at column 0. That made the same
    // column mean two things depending on how it was written (carve-js#767).
    expect(h('1. a\n\t> quote')).toBe(h('1. a\n    > quote'))
    expect(h('1. a\n\t> quote')).not.toContain('<blockquote>')
  })

  it('still nests a block opener AT the content column', () => {
    // The boundary the assertion above needs: making every indented opener
    // text would satisfy it and break the shape authors write.
    expect(h('1. a\n   > quote')).toBe(
      '<ol>\n  <li>a\n    <blockquote><p>quote</p></blockquote>\n  </li>\n</ol>',
    )
  })

  it('parses a block opener after a sub-list as an outer-item sibling block', () => {
    // `> q` returns to the item content column after the sub-list, so it is a
    // block quote sibling of the sub-list within the outer item, not lazy text.
    expect(h('1. a\n   1. b\n   > q')).toBe(
      '<ol>\n  <li>a\n    <ol>\n      <li>b</li>\n    </ol>\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ol>',
    )
  })
})
