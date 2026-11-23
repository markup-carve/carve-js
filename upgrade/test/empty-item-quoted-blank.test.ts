import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'
import { upgrade } from '../src/index.ts'

describe('U-017: the blank line below an item that 0.1 left empty, in a quote', () => {
  it.each([
    ['> 1. - +\n> para\n', '> 1. - {%%}\n>\n> para\n'],
    ['> > - +\n> para\n', '> > - {%%}\n>\n> para\n'],
    ['> 1. - +\n>para\n', '> 1. - {%%}\n>\n>para\n'],
  ])('keeps the quote marks the next line holds: %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(render(result.output)).toBe(carveToHtml(source))
  })
})
