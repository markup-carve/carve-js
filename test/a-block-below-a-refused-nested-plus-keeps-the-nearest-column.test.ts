import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// CARVE-P11-042: for `- foo` over `  1. +`, an outer block starts at column 3;
// column 2 would attach it to `1.`.
describe('a block below a refused nested plus keeps the nearest column', () => {
  it.each([
    ['- foo\n  1. +\n    > b\n', '- foo\n  1. +\n   > b\n'],
    ['- foo\n  1. +\n    ```\n    x\n    ```\n', '- foo\n  1. +\n   ```\n   x\n   ```\n'],
    ['> - foo\n>   1. +\n>     > b\n', '> - foo\n>   1. +\n>    > b\n'],
  ])('%j', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })
})
