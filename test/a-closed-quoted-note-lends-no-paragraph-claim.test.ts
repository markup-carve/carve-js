import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('opens an item list after prose outside a closed quoted note', () => {
  const source = '- a\n   > quote\n  > [^n]: note\n      q\n      1. ordered\n'
  expect(carveToHtml(source)).toBe(
    '<ul>\n' +
    '  <li>a\n' +
    '    <blockquote><p>quote</p></blockquote>\n' +
    '    q\n' +
    '    <ol>\n' +
    '      <li>ordered</li>\n' +
    '    </ol>\n' +
    '  </li>\n' +
    '</ul>',
  )
})
