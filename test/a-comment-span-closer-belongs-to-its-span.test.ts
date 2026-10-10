import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// markup-carve/carve-js#2255, the ruling in markup-carve/carve#2484 and the
// oracle's own fix in markup-carve/carve#2503 and #2505. Every expectation is the
// oracle's (`scripts/spec/layout.mjs` into `scripts/spec/html.mjs` in
// markup-carve/carve at e70b5597), run rather than read.
//
// A container ends at a comment written below its content column, which is right
// for an OPENER and for the `%%` line form. It is wrong for the other half of a
// span the container already holds: PART 9 §28 pairs the delimiters and
// indentation is part of neither, so ending there split the pair. The container's
// own parse then read an opener with no closer, which §28 makes one `%%` line
// comment - so the payload reached the page while both delimiters did not.
//
// The closer's column is not a parameter: the same span closed at the opener's own
// base hides its payload, which is what each reproducer's control asserts.

const NOTE_HIDDEN =
  '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  '      <p>head<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>\n' +
  '    </li>\n  </ol>\n</section>'

describe("a comment span's closer belongs to its span", () => {
  it.each([
    [
      'a description body',
      ':: t\n:  head\n\n     %%%\n     a\n%%%\n',
      '<dl>\n  <dt>t</dt>\n  <dd>head</dd>\n</dl>',
    ],
    ['a note body', 'see[^f]\n\n[^f]: head\n\n  %%%\n  a\n%%%\n', NOTE_HIDDEN],
    [
      'two spans in a list item',
      '- head\n\n    %%%\n    a\n%%%\n    %%%\n    b\n    %%%\n\n  tail\n',
      '<ul>\n  <li><p>head</p>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
    [
      'a nested list item',
      '- o\n  - head\n\n    %%%\n    a\n%%%\n%%%\n    b\n    %%%\n',
      '<ul>\n  <li>o\n    <ul>\n      <li>head</li>\n    </ul>\n  </li>\n</ul>',
    ],
  ])('%s hides the payload', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  // THE CONTROLS THE READING IS ASSERTED AGAINST, each the same span closed at the
  // opener's own base. They already agreed, and they are what says the closer's
  // column is not a parameter rather than that the fix happened to land here.
  it.each([
    [
      'a description body',
      ':: t\n:  head\n\n     %%%\n     a\n     %%%\n',
      '<dl>\n  <dt>t</dt>\n  <dd>head</dd>\n</dl>',
    ],
    ['a note body', 'see[^f]\n\n[^f]: head\n\n  %%%\n  a\n  %%%\n', NOTE_HIDDEN],
    [
      'two spans in a list item',
      '- head\n\n    %%%\n    a\n    %%%\n    %%%\n    b\n    %%%\n\n  tail\n',
      '<ul>\n  <li><p>head</p>\n    <p>tail</p>\n  </li>\n</ul>',
    ],
  ])('control: %s at the base hides it too', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  // A BLOCK OPENED ON A MARKER LINE, and both directions of misreading it publish
  // a payload. Read as written, the marker line is no fence, so the `%%%` under it
  // becomes an opener and the real delimiter below is kept as that phantom's
  // closer. Stripped unconditionally, the same line folds into the open paragraph
  // (§10 I2 - a marker never interrupts) and the invented opaque body hides a real
  // opener instead.
  it.each([
    [
      'a marker-line fence makes the payload opaque',
      ':: t\n:  head\n\n   - ```\n   %%%\n   p\n%%%\n\n   tail\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>head</p>\n    <ul>\n      <li>\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>p</p>\n  </dd>\n</dl>\n<p>tail</p>',
    ],
    [
      'the checkbox goes with the marker',
      ':: t\n:  head\n\n   - [ ] ```\n   %%%\n   p\n%%%\n\n   tail\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>head</p>\n    <ul class="task-list">\n      <li><input type="checkbox" disabled> \n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>p</p>\n  </dd>\n</dl>\n<p>tail</p>',
    ],
    [
      'an abutting attribute comes off with the marker',
      ':: t\n:  head\n\n   -{.x} ```\n   %%%\n   p\n%%%\n\n   tail\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>head</p>\n    <ul>\n      <li class="x">\n        <pre><code></code></pre>\n      </li>\n    </ul>\n    <p>p</p>\n  </dd>\n</dl>\n<p>tail</p>',
    ],
    [
      'mid-paragraph the same line opens nothing',
      ':: t\n:  head\n   - ```\n   %%%\n   p\n%%%\n\n   tail\n',
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>head\n- <code></code></p>\n    <p>tail</p>\n  </dd>\n</dl>',
    ],
  ])('%s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })
})
