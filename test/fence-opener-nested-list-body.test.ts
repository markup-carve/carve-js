import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

// A `:::` admonition/div opener that is the LEAD content of a list item must
// open even when its body is a NESTED LIST, exactly as it already does for an
// empty or paragraph body. The grammar admits any block (a nested list
// included) as admonition body, and the normative closer-lookahead (§10) opens
// the container iff a matching closer exists ahead. Previously carve-js split
// the lead colon-fence opener from the indented sub-list, leaving `::: note`
// literal and the closer as trailing text. carve-rs is the oracle; these
// outputs match it byte-for-byte (except the empty-body guard, whose blank-line
// whitespace is a pre-existing js/rs difference unrelated to the opener bug).
describe('a list-item colon-fence opener captures a nested-list body (§10/§12)', () => {
  it('opens an admonition wrapping a nested unordered list', () => {
    expect(html('- ::: note\n  - para text\n  :::')).toBe(
      [
        '<ul>',
        '  <li>',
        '    <aside class="admonition note">',
        '      <ul>',
        '        <li>para text</li>',
        '      </ul>',
        '    </aside>',
        '  </li>',
        '</ul>',
      ].join('\n'),
    )
  })

  it('opens an admonition wrapping a nested ordered list', () => {
    expect(html('- ::: note\n  1. para text\n  :::')).toBe(
      [
        '<ul>',
        '  <li>',
        '    <aside class="admonition note">',
        '      <ol>',
        '        <li>para text</li>',
        '      </ol>',
        '    </aside>',
        '  </li>',
        '</ul>',
      ].join('\n'),
    )
  })

  it('opens an admonition wrapping a two-item nested list', () => {
    expect(html('- ::: note\n  - one\n  - two\n  :::')).toBe(
      [
        '<ul>',
        '  <li>',
        '    <aside class="admonition note">',
        '      <ul>',
        '        <li>one</li>',
        '        <li>two</li>',
        '      </ul>',
        '    </aside>',
        '  </li>',
        '</ul>',
      ].join('\n'),
    )
  })

  it('opens with a blank line between the opener and the nested list', () => {
    expect(html('- ::: note\n\n  - para text\n  :::')).toBe(
      [
        '<ul>',
        '  <li>',
        '    <aside class="admonition note">',
        '      <ul>',
        '        <li>para text</li>',
        '      </ul>',
        '    </aside>',
        '  </li>',
        '</ul>',
      ].join('\n'),
    )
  })

  // Negative boundary: with NO closer, the opener stays literal text and the
  // nested list parses as a normal sub-list of the item.
  it('stays literal when no closer follows the nested-list body', () => {
    expect(html('- ::: note\n  - para text')).toBe(
      [
        '<ul>',
        '  <li>::: note',
        '    <ul>',
        '      <li>para text</li>',
        '    </ul>',
        '  </li>',
        '</ul>',
      ].join('\n'),
    )
  })

  // Negative boundary: a closer at column 0 is OUTSIDE the item, so it does not
  // close the in-item opener -- the opener stays literal and the closer is a
  // top-level paragraph.
  it('stays literal when the closer is at column 0 (outside the item)', () => {
    expect(html('- ::: note\n  - para text\n:::')).toBe(
      [
        '<ul>',
        '  <li>::: note',
        '    <ul>',
        '      <li>para text</li>',
        '    </ul>',
        '  </li>',
        '</ul>',
        '<p>:::</p>',
      ].join('\n'),
    )
  })

  // Regression guards: the empty-body and paragraph-body forms already opened
  // before this fix and must keep opening. The empty-body output carries a
  // blank line inside the empty <aside> (a pre-existing carve-js rendering of
  // an empty container; carve-rs omits it) -- unrelated to the opener fix.
  it('still opens with an empty body', () => {
    expect(html('- ::: note\n  :::')).toBe(
      [
        '<ul>',
        '  <li>',
        '    <aside class="admonition note">',
        '',
        '    </aside>',
        '  </li>',
        '</ul>',
      ].join('\n'),
    )
  })

  it('still opens with a paragraph body', () => {
    expect(html('- ::: note\n  para\n  :::')).toBe(
      [
        '<ul>',
        '  <li>',
        '    <aside class="admonition note">',
        '      <p>para</p>',
        '    </aside>',
        '  </li>',
        '</ul>',
      ].join('\n'),
    )
  })
})
