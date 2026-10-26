import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

describe('fast HTML table row base', () => {
  it('ends before an indented row after a delimiter', () => {
    const source = '|a|\n|---|\n|b|\n |c|'
    expect(carveToHtml(source)).toContain('</table>\n<p>|c|</p>')
    expect(carveToAstJson(source).children.map(node => node.type)).toEqual(['table', 'paragraph'])
  })

  it.each([' ', '  ', '\t'])('leaves a row indented with %j to the parser', indent => {
    const source = `|a|\n|---|\n|b|\n${indent}|c|`
    expect(carveToHtml(source)).toContain('</table>\n<p>|c|</p>')
  })

  it('keeps a flush row inside the table', () => {
    expect(carveToHtml('|a|\n|---|\n|b|\n|c|')).toContain('<tr><td>c</td></tr>')
  })
})
