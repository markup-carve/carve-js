import { test, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// The item one column past the body column is a sibling item of one loose list, as in the spec model.
test('a list item one column past a description body joins the list above', () => {
  for (const [first, second, tail, written2] of [
    ['- a', '- c', '\t', '- c'],
    ['* alpha', '* beta', '  ', '* beta'],
    ['1. first', '1. second', '', '2. second'],
  ]) {
    const source = `:: term\n: ${first}\n\n   ${second}${tail}\n`
    const written = carveToCarve(source)
    expect(carveToHtml(written), source).toBe(carveToHtml(source))
    expect(carveToCarve(written), source).toBe(written)
    expect(written, source).toBe(`:: term\n: ${first}\n\n  ${written2}\n`)
  }
})

test('a shifted list keeps all of its items and nested children', () => {
  for (const [first, body] of [
    ['- a', '- c\n   - d'],
    ['1. a', '1. c\n   2. d'],
    ['9. a', '9. c\n   10. d'],
    ['- a', '- c\n     - nested'],
    ['- a', '- c\n\n    - e'],
    ['- a', '- c\n\n   - d'],
  ]) {
    const source = `:: term\n: ${first}\n\n   ${body}\n`
    const written = carveToCarve(source)
    expect(carveToHtml(written), source).toBe(carveToHtml(source))
    expect(carveToCarve(written), source).toBe(written)
  }
})
