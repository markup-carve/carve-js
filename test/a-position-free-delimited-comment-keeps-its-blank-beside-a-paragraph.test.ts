import { expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, renderCarve } from '../src/index.js'

const withoutPositions = (source: string): unknown =>
  JSON.parse(JSON.stringify(carveToAstJson(source), (key, value) => key === 'pos' ? undefined : value))

it.each([
  '- x\n\n  {% a z %}\n',
  '- p\n\n  {% a\n   - m\n   z %}\n',
  '- {% a z %}\n\n  y\n',
  '- x\n  - y\n\n  {% a %}\n',
  '> - x\n>\n>   {% a %}\n',
])('keeps the blank between a delimited comment and a paragraph without positions (carve-js#5012): %j', (source) => {
  const tree = withoutPositions(source)
  const written = renderCarve(fromAstJson(tree))
  expect(written).toBe(renderCarve(fromAstJson(carveToAstJson(source))))
  expect(withoutPositions(written)).toEqual(tree)
  expect(carveToHtml(written)).toBe(carveToHtml(source))
})
