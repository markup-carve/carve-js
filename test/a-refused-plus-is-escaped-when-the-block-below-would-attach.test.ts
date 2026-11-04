import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#4868 as amended by carve#5145 (CARVE-P11-040): the corpus 929 bytes.
describe('a refused plus is escaped when the block below would attach', () => {
  it.each([

    ['- - +\n\n  > q\n', '- - {empty}\n\n  > q\n'],
    ['- - +\n\n  ```\n  x\n  ```\n', '- - {empty}\n\n  ```\n  x\n  ```\n'],
    ['- - +\n\n  # H\n', '- - {empty}\n\n  # H\n'],
    ['- - +\n\n  {.c}\n  > q\n', '- - {empty}\n\n  {.c}\n  > q\n'],
    ['- foo\n  1. +\n   > b\n', '- foo\n  1. {empty}\n   > b\n'],
    ['- - - +\n\n    > q\n', '- - - {empty}\n\n    > q\n'],
    ['> - - +\n>\n>   > q\n', '> - - {empty}\n>\n>   > q\n'],

  ])('%j', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })

  it.each([
    ['- - +\n\n  para\n', '- - {empty}\n\n  para\n'],
    ['- - +\n\n  $$\n  x\n  $$\n', '- - {empty}\n\n  $$\n  x\n  $$\n'],
    ['- - +\n\n  - b\n', '- - {empty}\n\n  - b\n'],
  ])('preserves the loose reading of %j', (source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  it('still moves a block below an empty item, which has no letter to escape', () => {
    const source = '- - %%\n\n  > q\n'
    const written = carveToCarve(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })
})
