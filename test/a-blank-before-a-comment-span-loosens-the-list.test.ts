import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §17 L1: the blank line is what loosens the item, and an invisible
// construct written after it does not fill the gap. Every other invisible
// construct already read that way here - the `%%` line, a dropped raw block, a
// link reference definition, a bare attribute line - and the comment SPAN did
// not, because the tail scan asks a per-line question and a span's payload is
// not an invisible line (markup-carve/carve-js#2333).
//
// No corpus row holds the shape, so these are direct assertions.
describe('a blank line before a comment span loosens the list', () => {
  it.each([
    ['the span form', '- t\n\n  %%%\n  c\n  %%%\n- s\n'],
    ['the line form it has to match', '- t\n\n  %% c\n- s\n'],
    ['a four-wide span', '- t\n\n  %%%%\n  c\n  %%%%\n- s\n'],
    ['an opener carrying a tail', '- t\n\n  %%% note\n  c\n  %%%\n- s\n'],
    ['a closer one column below the content column', '- t\n\n  %%%\n  c\n %%%\n- s\n'],
    ['a closer at column zero', '- t\n\n  %%%\n  c\n%%%\n- s\n'],
    ['two blank lines', '- t\n\n\n  %%%\n  c\n  %%%\n- s\n'],
    ['a span holding its own blank line', '- t\n\n  %%%\n  c\n\n  d\n  %%%\n- s\n'],
  ])('%s', (_name, source) => {
    expect(carveToHtml(source)).toBe('<ul>\n  <li><p>t</p></li>\n  <li><p>s</p></li>\n</ul>')
  })

  it('reaches a sub-list attached from the band', () => {
    expect(carveToHtml('- outer\n  - t\n\n    %%%\n    c\n   %%%\n   - b\n')).toBe(
      '<ul>\n  <li>outer\n    <ul>\n      <li><p>t</p></li>\n      <li><p>b</p></li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('needs the blank line, not the span', () => {
    expect(carveToHtml('- t\n  %%%\n  c\n  %%%\n- s\n')).toBe(
      '<ul>\n  <li>t</li>\n  <li>s</li>\n</ul>',
    )
  })

  // An opener with no run of its exact width ahead opens nothing (PART 9 §28),
  // so it hides nothing and `c` below it is the item's own content - a second
  // paragraph behind one invisible line, which loosens the item the way the
  // `%% c` spelling of that line does. The tightness was the open divergence
  // markup-carve/carve-js#2337 named; it belongs to the second-paragraph scan,
  // and this expectation moved with it, re-derived from the oracle at
  // markup-carve/carve 5b70a768.
  it('an opener that cannot close hides nothing', () => {
    expect(carveToHtml('- t\n\n  %%%%\n  c\n  %%%\n- s\n')).toBe(
      '<ul>\n  <li><p>t</p>\n    <p>c</p>\n  </li>\n  <li><p>s</p></li>\n</ul>',
    )
  })

  // A run inside VERBATIM payload is the code's content, so it opens no comment
  // block and the blank above it stays inside the code. The unterminated fence
  // may be authored on the marker line, where it is not one of the item's
  // collected lines at all.
  it.each([
    ['a fence on the marker line', '- ```\n  x\n\n  %%%\n  c\n  %%%\n- s\n'],
    ['a fence below it', '- t\n\n  ```\n  x\n\n  %%%\n  c\n  %%%\n- s\n'],
    ["a fence on a CHILD item's marker line", '- outer\n  - ```\n    x\n\n    %%%\n    c\n    %%%\n- s\n'],
  ])('a %%%%%% run inside verbatim payload is not a comment block: %s', (_name, source) => {
    expect(carveToHtml(source)).toContain('<li>s</li>')
  })

  it('a comment span after a CLOSED code fence still loosens', () => {
    expect(carveToHtml('- t\n\n  ```\n  x\n  ```\n\n  %%%\n  c\n  %%%\n- s\n')).toBe(
      '<ul>\n  <li><p>t</p>\n    <pre><code>x\n</code></pre>\n  </li>\n  <li><p>s</p></li>\n</ul>',
    )
  })
})
