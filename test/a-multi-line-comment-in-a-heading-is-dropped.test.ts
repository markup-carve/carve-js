import { describe, expect, it } from 'vitest'
import { carveToCarve, htmlToCarve } from '../src/index.js'

// markup-carve/carve#2396: a heading is one line, so a comment holding a line
// break has no spelling in one.
describe('an HTML comment in a heading', () => {
  it('is dropped with a row when it holds a line break', () => {
    const result = htmlToCarve('<h2>a <!-- x\ny --> b</h2>')
    expect(result.value).toBe('## a  b\n')
    expect(carveToCarve(result.value)).toBe(result.value)
    expect(result.report.diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual([
      ['element-dropped', 'warning', '/h2[1]/comment()[2]'],
    ])
  })

  it('is kept when it is one line', () => {
    const result = htmlToCarve('<h2>a <!-- one --> b</h2>')
    expect(result.value).toBe('## a {%  one  %} b\n')
    expect(result.report.diagnostics).toEqual([])
  })
})
