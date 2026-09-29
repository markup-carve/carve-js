import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §17 L1 / L1b, as markup-carve/carve#2548 ruled and carve#2558 pinned in
// corpus 517: the clause names no column, so a second paragraph written in the
// band between the marker column and the content column separates the item just
// as its content-column twin does (corpus 186). A sub-list attached from the band
// consumes the separation instead, and stays tight.
//
// Asserted here rather than left to the corpus runner: the spec pin predates
// corpus 517, and the reading regressed within the hour it was ruled
// (carve-js#2330, via carve-js#2300).
describe('a band paragraph after an invisible line leaves the item loose', () => {
  it.each([
    ['the narrowest band', '- t\n\n  %% c\n z\n', '<ul>\n  <li><p>t</p>\n    <p>z</p>\n  </li>\n</ul>'],
    [
      'a three-column band under a four-wide marker',
      '10. t\n\n    %% c\n   z\n',
      '<ol start="10">\n  <li><p>t</p>\n    <p>z</p>\n  </li>\n</ol>',
    ],
    [
      "that band's content-column twin",
      '10. t\n\n    %% c\n    z\n',
      '<ol start="10">\n  <li><p>t</p>\n    <p>z</p>\n  </li>\n</ol>',
    ],
    [
      'the span spelling of the invisible line',
      '- t\n\n  %%%\n  c\n  %%%\n z\n',
      '<ul>\n  <li><p>t</p>\n    <p>z</p>\n  </li>\n</ul>',
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it('a sub-list attached from the band keeps the list tight', () => {
    expect(carveToHtml('- t\n\n  %% c\n - b\n- s\n')).toBe(
      '<ul>\n  <li>t\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n  <li>s</li>\n</ul>',
    )
  })

  it('a following sibling marker is not what the blank has to separate', () => {
    expect(carveToHtml('- t\n\n  %% c\n z\n- s\n')).toBe(
      '<ul>\n  <li><p>t</p>\n    <p>z</p>\n  </li>\n  <li><p>s</p></li>\n</ul>',
    )
  })
})
