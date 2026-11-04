import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#4868, as amended by carve#5013/#5145: the refused `+` leaves an empty item,
// written `{empty}` (CARVE-P11-040), and the block below stays in the outer item.
describe('a block below a refused nested plus keeps the nearest column', () => {
  it.each([
    ['- foo\n  1. +\n    > b\n', '- foo\n  1. {empty}\n   > b\n'],
    ['- foo\n  1. +\n    ```\n    x\n    ```\n', '- foo\n  1. {empty}\n   ```\n   x\n   ```\n'],
    ['> - foo\n>   1. +\n>     > b\n', '> - foo\n>   1. {empty}\n>    > b\n'],
  ])('%j', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })
})
