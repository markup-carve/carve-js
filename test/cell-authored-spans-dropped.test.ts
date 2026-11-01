import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('only grid markers shape table cell spans (carve#4715)', () => {
  it('drops an authored rowspan without a computed span', () => {
    expect(carveToHtml('|{rowspan=2} a | b |\n| c | d |\n')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n    <tr><td>c</td><td>d</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('drops an authored colspan and case-insensitive span spelling', () => {
    expect(carveToHtml('|{colspan=2 ROWSPAN=3} a | b |\n')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('keeps authored alignment beside a computed column alignment', () => {
    expect(carveToHtml('|>{align=left} a |\n')).toBe(
      '<table>\n  <tbody>\n    <tr><td align="left" style="text-align: right;">a</td></tr>\n  </tbody>\n</table>',
    )
  })
})
