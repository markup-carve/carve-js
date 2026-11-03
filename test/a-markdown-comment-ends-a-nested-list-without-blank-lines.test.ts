import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

// CARVE-P2-034 (carve#4917): the list boundary follows a list-ending comment with no blank lines around it too (#4289).
describe('a Markdown comment ends a nested list without blank lines', () => {
  it.each([
    ['- x\n  - a\n  <!-- c -->\n  - b\n', '- x\n\n  - a\n\n  %% c\n\n\n\n  - b\n'],
    ['- - a\n  <!-- c -->\n  - b\n', '- - a\n\n  %% c\n\n\n\n  - b\n'],
  ])('imports %j with the boundary after the comment', (markdown, carve) => {
    expect(markdownToCarve(markdown)).toBe(carve)
  })

  it('keeps the inner lists apart while the outer item reads loose', () => {
    expect(carveToHtml(markdownToCarve('- x\n  - a\n  <!-- c -->\n  - b\n'))).toBe(
      '<ul>\n  <li><p>x</p>\n    <ul>\n      <li>a</li>\n    </ul>\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>')
  })

  it('reads a backtick line four columns past its item as indented code, not a fence', () => {
    expect(markdownToCarve('- a\n\n      ```\n<!-- c -->\n- b\n')).toBe("- a\n\n  ````\n  ```\n  ````\n\n%% c\n\n\n\n- b\n")
  })
})
