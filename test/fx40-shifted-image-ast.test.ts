import { expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, renderHtml } from '../src/index.js'

it('publishes final attributes on a shifted block image without duplicating them', () => {
  const source = '{.outer k=one}\n ![a](b){.inner k=two}\n'
  const ast = carveToAstJson(source)
  expect(ast.children[0]).toMatchObject({
    type: 'paragraph', blockImage: true,
    children: [{ type: 'image', attrs: { classes: ['outer', 'inner'], keyValues: { k: 'two' } } }],
  })
  expect(ast.children[0]).not.toHaveProperty('attrs')
  expect(renderHtml(fromAstJson(ast))).toBe(carveToHtml(source))
})

it('publishes the same merged image attributes inside a div', () => {
  const source = '::: box\n{.outer}\n ![a](b){.inner}\n:::\n'
  const ast = carveToAstJson(source)
  expect(ast.children[0]).toMatchObject({
    children: [{
      type: 'paragraph', blockImage: true,
      children: [{ type: 'image', attrs: { classes: ['outer', 'inner'] } }],
    }],
  })
  expect(renderHtml(fromAstJson(ast))).toBe(carveToHtml(source))
})
