import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

describe('an abbreviation expansion drops trailing whitespace', () => {
  for (const suffix of [' ', '\t', ' \t ']) {
    it(`drops ${JSON.stringify(suffix)} at the physical line end`, () => {
      const source = `A\n*[A]: expansion${suffix}\n`
      const ast = parse(source)
      const definition = ast.children.find((node) => node.type === 'abbreviation_def')

      expect(definition).toMatchObject({ expansion: 'expansion' })
      expect(carveToHtml(source)).toBe('<p><abbr title="expansion">A</abbr></p>')
    })
  }

  it('keeps a tab when later content makes it interior', () => {
    const source = 'A\n*[A]: expansion\tmore\n'
    const ast = parse(source)
    const definition = ast.children.find((node) => node.type === 'abbreviation_def')

    expect(definition).toMatchObject({ expansion: 'expansion\tmore' })
  })
})
