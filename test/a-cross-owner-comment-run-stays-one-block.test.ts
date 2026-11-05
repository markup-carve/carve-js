import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#5207: source-adjacent comments form one block across ownership columns.
describe('a consecutive comment run between list items', () => {
  it.each([
    ['- a\n\n  %% y\n%% z\n- c\n', '- a\n\n  %% y\n%% z\n\n- c\n'],
    ['- a\n\n  %% y\n%% z\n  %% w\n- c\n', '- a\n\n  %% y\n%% z\n  %% w\n\n- c\n'],
  ])('keeps source columns and the list: %j', (source, expected) => {
    expect(carveToCarve(source)).toBe(expected)
    expect(carveToCarve(expected)).toBe(expected)
    expect(carveToHtml(expected)).toBe(carveToHtml(source))
  })
})
