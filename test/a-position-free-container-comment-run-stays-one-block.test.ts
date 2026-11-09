import { expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, renderCarve } from '../src/index.js'

it('keeps adjacent container-owned line comments in one writer run without positions (carve-js#4831)', () => {
  const source = '- a\n\n  %% y\n  %% z\n- c\n'
  const ast = carveToAstJson(source)
  const withoutPositions = JSON.parse(JSON.stringify(ast, (key, value) => key === 'pos' ? undefined : value))
  const written = renderCarve(fromAstJson(withoutPositions))
  expect(written).toBe('- a\n\n  %% y\n  %% z\n\n- c\n')
  expect(carveToHtml(written)).toBe(carveToHtml(source))
})
