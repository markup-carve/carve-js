import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const table = '<table>\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n  </tbody>\n</table>'

describe('empty list item after a table', () => {
  it('takes the flush-left line after a first-block marker', () => {
    expect(carveToHtml('| a | b |\n  - +\nline two\n')).toBe(
      `${table}\n<ul>\n  <li>line two</li>\n</ul>`,
    )
  })

  it('leaves an indented line outside the item', () => {
    expect(carveToHtml('| a | b |\n  - +\n  line two\n')).toBe(
      `${table}\n<ul>\n  <li></li>\n</ul>\n<p>line two</p>`,
    )
  })
})

it('does not attach a flush-left list marker as the first block', () => {
  expect(carveToHtml(' - a\n +\n- b\n')).toBe('<ul>\n  <li>a\n+</li>\n</ul>\n<ul>\n  <li>b</li>\n</ul>')
})

it('does not attach a flush-left heading as the first block', () => {
  expect(carveToHtml(' - a\n +\n# h\n')).toBe('<ul>\n  <li>a\n+</li>\n</ul>\n<section id="h">\n  <h1>h</h1>\n</section>')
})
