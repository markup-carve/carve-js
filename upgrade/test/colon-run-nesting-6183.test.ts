import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { compareHtmlExact } from '../src/compare.ts'
import { upgrade } from '../src/index.ts'

const keeps = (source: string, output: string): void => {
  expect(compareHtmlExact(carveToHtml(source), render(output)).equal).toBe(true)
}

describe('U-219: a bare colon run that 0.1 read as a nested div opener', () => {
  it.each([
    ['::: a\nx\n:::::\n:::\nafter\n', '::::: a\nx\n::::\n:::\nafter\n'],
    ['> ::: a\n> x\n> ::::\n> y\n', '> :::: a\n> x\n> :::\n> y\n'],
    ['- ::: a\n  x\n  ::::\n  y\n', '- :::: a\n  x\n  :::\n  y\n'],
    ['::::\nx\n:::\ny\n::::\nz\n', ':::::\nx\n::::\ny\n:::\nz\n'],
    [':::: a\nx\n::::::\ny\n::::::\n::::\nz\n', ':::: a\nx\n:::\ny\n:::\n::::\nz\n'],
  ])('shortens the runs toward the inside, each closer as long as its opener: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    keeps(source, result.output)
  })

  it('leaves runs alone where 0.2 already reads the same nesting', () => {
    const source = ':::: a\nx\n::: b\ny\n:::\n::::\n'
    expect(upgrade(source).output).toBe(source)
  })
})

describe('U-034: an attribute-only quote under the image line of a figure', () => {
  it('keeps the empty 0.1 quote that 0.2 would read as lazy image text', () => {
    const source = '::: figure\n![a](b.png)\n> {#x}\nz\n'
    const result = upgrade(source)
    expect(result.output).toBe('::: figure\n![a](b.png)\n\n> \nz\n')
    expect(result.check).toBe('pass')
    keeps(source, result.output)
  })
})

describe('ownership-af9b5e482372 (carve#6183)', () => {
  it('keeps the 0.1 HTML of an admonition, a figure, an empty quote and nested bare runs', () => {
    const source = '::: note\n> para\n  ::: figure\n  ![a](b.png)\n> {#x}\n``\ncode\n:::::\n:::\nafter *b*\n'
    const result = upgrade(source)
    expect(result.output).toBe(':::::: note\n> para\n  ::::: figure\n  ![a](b.png)\n\n> \n``\ncode``\n::::\n:::\nafter *b*\n')
    expect(result.check).toBe('pass')
    keeps(source, result.output)
  })
})
