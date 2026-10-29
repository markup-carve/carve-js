import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The quoted note's open paragraph takes both lines lazily (carve#3885).
it('folds prose and a marker below a quoted note into the note', () => {
  const source = '- a\n   > quote\n  > [^n]: note\n      q\n      1. ordered\n'
  expect(carveToHtml(source)).toBe(
    '<ul>\n' +
    '  <li>a\n' +
    '    <blockquote><p>quote</p></blockquote>\n' +
    '  </li>\n' +
    '</ul>',
  )
})
