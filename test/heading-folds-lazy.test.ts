import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A heading folds trailing flush-left plain text as continuation (PART 2
 * multi-line headings), no matter how deeply the heading is nested. Previously a
 * heading that ended a list item let the following flush-left line escape to a
 * top-level paragraph, or (when nested) attach as stray item text. All now fold
 * into the heading, matching carve-php / carve-rs (carve#326).
 */
describe('a heading folds trailing lazy text when nested', () => {
  it('an indented item heading after a blank folds the lazy line', () => {
    expect(carveToHtml('- text\n\n  # N\nlazy')).toBe(
      '<ul>\n  <li>text\n    <h1 id="N-lazy">N\nlazy</h1>\n  </li>\n</ul>',
    )
  })

  it('a nested marker-line heading folds the lazy line', () => {
    expect(carveToHtml('- a\n  - # N\nlazy')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <h1 id="N-lazy">N\nlazy</h1>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('a deeply nested indented heading folds the lazy line', () => {
    expect(carveToHtml('- a\n  - b\n    # N\nlazy')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <h1 id="N-lazy">N\nlazy</h1>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('a blank after the heading still ends it', () => {
    expect(carveToHtml('- a\n  - # N\n\nsep')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <h1 id="N">N</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>sep</p>',
    )
  })
})
