import { expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, renderHtml } from '../src/index.js'

// Ruling A on markup-carve/carve#5039: promotion moves no attributes on the wire.
it('keeps a shifted block image attribute line on its paragraph', () => {
  const source = '{.outer k=one}\n ![a](b){.inner k=two}\n'
  const ast = carveToAstJson(source)
  expect(ast.children[0]).toMatchObject({
    type: 'paragraph', blockImage: true,
    attrs: { classes: ['outer'], keyValues: { k: 'one' } },
    children: [{ type: 'image', attrs: { classes: ['inner'], keyValues: { k: 'two' } } }],
  })
  expect(renderHtml(fromAstJson(ast))).toBe(carveToHtml(source))
})

it('keeps the same split inside a div', () => {
  const source = '::: box\n{.outer}\n ![a](b){.inner}\n:::\n'
  const ast = carveToAstJson(source)
  expect(ast.children[0]).toMatchObject({
    children: [{
      type: 'paragraph', blockImage: true, attrs: { classes: ['outer'] },
      children: [{ type: 'image', attrs: { classes: ['inner'] } }],
    }],
  })
  expect(renderHtml(fromAstJson(ast))).toBe(carveToHtml(source))
})
