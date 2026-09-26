import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// markup-carve/carve-js#2124: a marker-attached block contributes zero to the
// content column (PART 9 §24 C3), nested as at the top level.
describe('a nested item with a marker-attached block', () => {
  it.each([
    ['a bullet', '- x\n  -{.c} y\n    {.d}\n    - z\n', '<li class="c">y\n        <ul class="d">'],
    ['an ordered item', '1. x\n   1.{.c} y\n      {.d}\n      1. z\n', '<li class="c">y\n        <ol class="d">'],
    ['a task item', '- x\n  -{.c} [x] y\n    {.d}\n    - z\n', '<ul class="d">'],
  ])('keeps an attribute line at its content column inside it: %s', (_, src, inside) => {
    const html = carveToHtml(src)
    expect(html).toContain(inside)
    expect(html.match(/<\/li>/g)!.length).toBe(3)
    expect(carveToCarve(src)).toBe(src)
  })

  it('does not loosen the outer item for a blank inside it', () => {
    expect(carveToHtml('- x\n  -{.c} y\n\n    para\n')).toContain('<li>x\n')
  })
})
