import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

describe('fast HTML table row base', () => {
  it('keeps an indented row after a delimiter in the table', () => {
    const source = '|a|\n|---|\n|b|\n |c|'
    expect(carveToHtml(source)).toContain('<tr><td>c</td></tr>\n  </tbody>\n</table>')
    expect(carveToAstJson(source).children.map(node => node.type)).toEqual(['table'])
  })

  it.each([' ', '  ', '\t'])('leaves a row indented with %j to the parser', indent => {
    const source = `|a|\n|---|\n|b|\n${indent}|c|`
    expect(carveToHtml(source)).toContain('<tr><td>c</td></tr>\n  </tbody>\n</table>')
  })

  it('keeps a flush row inside the table', () => {
    expect(carveToHtml('|a|\n|---|\n|b|\n|c|')).toContain('<tr><td>c</td></tr>')
  })
})
