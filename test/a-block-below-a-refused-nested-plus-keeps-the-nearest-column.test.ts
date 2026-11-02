import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#4868: the refused `+` is a letter, spelled `\\+` so an outer block can
// stay at the enclosing content column.
describe('a block below a refused nested plus keeps the nearest column', () => {
  it.each([
    ['- foo\n  1. +\n    > b\n', '- foo\n  1. \\+\n  > b\n'],
    ['- foo\n  1. +\n    ```\n    x\n    ```\n', '- foo\n  1. \\+\n  ```\n  x\n  ```\n'],
    ['> - foo\n>   1. +\n>     > b\n', '> - foo\n>   1. \\+\n>   > b\n'],
  ])('%j', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })
})
