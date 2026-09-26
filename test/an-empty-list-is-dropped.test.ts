import { describe, expect, it } from 'vitest'
import { carveToCarve, htmlToAst, htmlToCarve } from '../src/index.js'

// markup-carve/carve#2367: a list with no item has no spelling.
describe('an empty list', () => {
  it.each([
    ['attributed, in a container', '<div class="m"><ul class="vector-menu-content-list"></ul></div><p>after</p>', '::: m\n\n:::\n\nafter\n', '/div[1]/ul[1]', 0],
    ['bare', '<ul></ul><p>a</p>', 'a\n', '/ul[1]', 0],
    ['ordered with a start', '<ol id="o" start="3"></ol><p>a</p>', 'a\n', '/ol[1]', 0],
    ['nested in an item', '<ul><li>a<ul class="n"></ul></li></ul>', '- a\n', '/ul[1]/li[1]/ul[2]', 1],
  ])('is dropped when %s', (_, html, carve, path, lists) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(carveToCarve(result.value)).toBe(result.value)
    expect(result.report.diagnostics).toEqual([expect.objectContaining({ code: 'element-dropped', severity: 'warning', path })])
    expect(JSON.stringify(htmlToAst(html).value).split('"type":"list"').length - 1).toBe(lists)
  })
})
