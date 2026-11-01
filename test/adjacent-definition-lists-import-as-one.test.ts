import { describe, expect, it } from 'vitest'
import { carveToCarve, htmlToAst, htmlToCarve } from '../src/index.js'

// carve#4759 gives adjacent definition lists a three-blank boundary.
describe('adjacent definition lists', () => {
  it.each([
    ['two tight lists', '<dl><dt>a</dt><dd>x</dd></dl><dl><dt>b</dt><dd>y</dd></dl>', ':: a\n: x\n\n\n\n:: b\n: y\n', 2],
    ['three lists', '<dl><dt>a</dt><dd>x</dd></dl>\n<dl><dt>b</dt><dd>y</dd></dl>\n<dl><dt>c</dt><dd>z</dd></dl>', ':: a\n: x\n\n\n\n:: b\n: y\n\n\n\n:: c\n: z\n', 3],
  ])('keep apart: %s', (_, html, carve, count) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(carveToCarve(result.value)).toBe(result.value)
    expect(result.report.diagnostics).toEqual([])
    expect(htmlToAst(html).value.children).toHaveLength(count)
  })

  // A leading <dd> whose content ends in a list must join the same way.
  it('keeps a list a leading <dd> left behind', () => {
    const html = '<dl><dd><dl><dt>x</dt><dd>y</dd></dl></dd><dt>t</dt><dd>d</dd></dl>'
    const result = htmlToCarve(html)
    expect(result.value).toBe(':: x\n: y\n\n\n\n:: t\n: d\n')
    expect(carveToCarve(result.value)).toBe(result.value)
    expect(result.report.diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual([
      ['element-unwrapped', 'warning', '/dl[1]/dd[1]'],
    ])
    expect(htmlToAst(html).value.children).toHaveLength(2)
  })

  it('keep apart: an attributed list after a leading <dd>', () => {
    const result = htmlToCarve('<dl class="k"><dd><dl><dt>x</dt><dd>y</dd></dl></dd><dt>t</dt><dd>d</dd></dl>')
    expect(result.value).toBe(':: x\n: y\n\n\n\n{.k}\n:: t\n: d\n')
    expect(carveToCarve(result.value)).toBe(result.value)
  })

  it.each([
    ['an attributed second list', '<dl><dt>a</dt><dd>x</dd></dl><dl class="k"><dt>b</dt><dd>y</dd></dl>', ':: a\n: x\n\n\n\n{.k}\n:: b\n: y\n'],
    ['a paragraph between', '<dl><dt>a</dt><dd>x</dd></dl><p>p</p><dl><dt>b</dt><dd>y</dd></dl>', ':: a\n: x\n\np\n\n:: b\n: y\n'],
  ])('keep apart: %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics).toEqual([])
  })
})
