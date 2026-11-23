import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { compareHtml } from '../src/compare.ts'
import { upgrade } from '../src/index.ts'

describe('U-237: a block after a nested list moves to the marker column of that list', () => {
  it.each([
    ['- ::: box\n  - inner\n   > q\n', '- ::: box\n  - inner\n\n  > q\n'],
    ['> - ::: box\n>   - inner\n>    > q\n', '> - ::: box\n>   - inner\n>\n>   > q\n'],
    ['- ::: box\n  - inner\n    %% c\n   > q\n', '- ::: box\n  - inner\n\n    %% c\n  > q\n'],
    ['> - :: x\n>  t\n', '> - :: x\n>\n> t\n'],
  ])('keeps the block outside the last item: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(render(result.output)).toBe(carveToHtml(source))
  })

  it.each([
    ['1. - - +\n    x\n', '1. - - {%%}\n\n   x\n'],
    ['- - +\n   x\n', '- - {%%}\n\n  x\n'],
    ['> 1. - - +\n>     x\n', '> 1. - - {%%}\n>\n>    x\n'],
  ])('keeps a paragraph below an empty item in the outer item: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('explained')
    expect(compareHtml(carveToHtml(source), render(result.output)).equal).toBe(true)
  })

  it('leaves a block that a + line attaches to U-016', () => {
    const result = upgrade('> - a\n>   b\n> +\n>  para\n')
    expect(result.output).toBe('> - a\n>   b\n>\n> para\n')
    expect(result.check).toBe('pass')
  })
})
