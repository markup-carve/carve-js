import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('counts the blank after a quote comment closer as item spacing (carve#5307)', () => {
  const source = '- a\n  > %%%\n  %%%\n\n  u\n'
  expect(carveToHtml(source)).toBe(
    '<ul>\n  <li><p>a</p>\n    <blockquote>\n\n    </blockquote>\n    <p>u</p>\n  </li>\n</ul>',
  )
})
