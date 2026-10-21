import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['- 1. ordered\n  >        q\n\n  \ttext\n', 'ordered'],
  ['- 1. ordered\n    1. ordered\n      [^n]: note\n        1. ordered\n  >        q\n\n  \ttext\n', 'ordered\n1. ordered'],
])('keeps the blank before the outer item paragraph', (source, innerText) => {
  expect(carveToHtml(source)).toBe(
    '<ul>\n' +
    '  <li>\n' +
    '    <ol>\n' +
    `      <li>${innerText}</li>\n` +
    '    </ol>\n' +
    '    <blockquote><p>q</p></blockquote>\n' +
    '    <p>text</p>\n' +
    '  </li>\n' +
    '</ul>',
  )
})
