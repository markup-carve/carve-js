import { test, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

test('adjacent tight lists stay in a description body', () => {
  for (const [first, second, tail] of [
    ['- a', '- c', '\t'],
    ['* alpha', '* beta', '  '],
    ['1. first', '1. second', ''],
  ]) {
    const source = `:: term\n: ${first}\n\n   ${second}${tail}\n`
    const written = carveToCarve(source)
    expect(carveToHtml(written), source).toBe(carveToHtml(source))
    expect(carveToCarve(written), source).toBe(written)
    expect(written, source).toContain(`\n\n   ${second}\n`)
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
