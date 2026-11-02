import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// A `+` at the marker column after a `+` offers the same block, and a refused one is a letter and is
// that block (§17 L3), after a first-block item's attached block as after any other.
describe('a run of plus lines after a first-block item', () => {
  const twins: Array<[string, string]> = [
    ['- +\npara\n+\n+\n> q\n', '- para\n+\n+\n> q\n'],
    ['- +\npara\n+\n+\nx\n', '- para\n+\n+\nx\n'],
    ['- +\npara\n+\n+\n+\nx\n', '- para\n+\n+\n+\nx\n'],
    ['- +\npara\n+\n+\n\nx\n', '- para\n+\n+\n\nx\n'],
    ['- +\npara\n+\n+\n- b\n', '- para\n+\n+\n- b\n'],
    ['- +\npara\n+\n+\n x\n', '- para\n+\n+\n x\n'],
  ]
  for (const [firstBlock, inline] of twins) {
    it(`reads ${JSON.stringify(firstBlock)} like ${JSON.stringify(inline)}`, () => {
      expect(flat(carveToHtml(firstBlock))).toBe(flat(carveToHtml(inline)))
    })
  }

  it('gives the item the quote the run offers', () => {
    expect(flat(carveToHtml('- +\npara\n+\n+\n> q\n'))).toBe('<ul><li>para<blockquote><p>q</p></blockquote></li></ul>')
  })
})
