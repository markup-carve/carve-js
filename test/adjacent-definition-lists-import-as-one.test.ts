import { describe, expect, it } from 'vitest'
import { carveToCarve, htmlToAst, htmlToCarve } from '../src/index.js'

// markup-carve/carve#2369: Carve source has no boundary between two
// definition lists, so an attribute-less one joins the list before it.
describe('adjacent definition lists', () => {
  it.each([
    ['two tight lists', '<dl><dt>a</dt><dd>x</dd></dl><dl><dt>b</dt><dd>y</dd></dl>', ':: a\n: x\n:: b\n: y\n', ['/dl[2]']],
    ['three lists', '<dl><dt>a</dt><dd>x</dd></dl>\n<dl><dt>b</dt><dd>y</dd></dl>\n<dl><dt>c</dt><dd>z</dd></dl>', ':: a\n: x\n:: b\n: y\n:: c\n: z\n', ['/dl[3]', '/dl[5]']],
  ])('merge: %s', (_, html, carve, paths) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(carveToCarve(result.value)).toBe(result.value)
    expect(result.report.diagnostics.map((d) => [d.code, d.severity, d.path])).toEqual(paths.map((p) => ['element-unwrapped', 'info', p]))
    expect(htmlToAst(html).value.children).toHaveLength(1)
  })

  it.each([
    ['an attributed second list', '<dl><dt>a</dt><dd>x</dd></dl><dl class="k"><dt>b</dt><dd>y</dd></dl>', ':: a\n: x\n\n{.k}\n:: b\n: y\n'],
    ['a paragraph between', '<dl><dt>a</dt><dd>x</dd></dl><p>p</p><dl><dt>b</dt><dd>y</dd></dl>', ':: a\n: x\n\np\n\n:: b\n: y\n'],
  ])('keep apart: %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics).toEqual([])
  })
})
