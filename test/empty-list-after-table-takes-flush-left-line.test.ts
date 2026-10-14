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
