import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('loosens an outer item after its child closes before a quote and blank', () => {
  const source = '- 1. ordered\n  > q\n\n      text\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <ol>\n      <li>ordered</li>\n    </ol>\n    <blockquote><p>q</p></blockquote>\n    <p>text</p>\n  </li>\n</ul>')
})

it('keeps a blank and following text in the child when no parent block intervenes', () => {
  const source = '- 1. ordered\n\n      text\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <ol>\n      <li><p>ordered</p>\n        <p>text</p>\n      </li>\n    </ol>\n  </li>\n</ul>')
})
