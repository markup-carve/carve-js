import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

describe('literal hyphen runs in Markdown table cells', () => {
  it('preserves a thematic-looking body cell', () => {
    const source = '|a|b|\n|---|---|\n|---|x|'
    const carve = markdownToCarve(source)
    expect(carve).toBe('|= a |= b |\n| \\-\\-\\- | x |')
    expect(carveToHtml(carve)).toContain('<tr><td>---</td><td>x</td></tr>')
  })

  it.each(['--', '---', '----'])('preserves %s in other cells', run => {
    const carve = markdownToCarve(`|a|b|\n|---|---|\n|x|${run}|`)
    expect(carveToHtml(carve)).toContain(`<tr><td>x</td><td>${run}</td></tr>`)
  })

  it('leaves a code span in a table cell intact', () => {
    const carve = markdownToCarve('|a|\n|---|\n|`---`|')
    expect(carveToHtml(carve)).toContain('<code>---</code>')
  })
})
