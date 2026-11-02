import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The quoted note's open paragraph takes the prose lazily (carve#3885); the marker
// misses the quote and opens a list in the item (PART 0 S3, carve#4860).
it('folds prose below a quoted note into the note and opens the item list at the marker', () => {
  const source = '- a\n   > quote\n  > [^n]: note\n      q\n      1. ordered\n'
  expect(carveToHtml(source)).toBe(
    '<ul>\n' +
    '  <li>a\n' +
    '    <blockquote><p>quote</p></blockquote>\n' +
    '    <ol>\n' +
    '      <li>ordered</li>\n' +
    '    </ol>\n' +
    '  </li>\n' +
    '</ul>',
  )
})
