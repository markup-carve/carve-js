import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToCarve, htmlToCarve } from '../src/index.js'

/**
 * PART 10 §12 / carve#2796. `1)` and `1.` rendered the same bytes, so a
 * document numbering its steps `1)` printed them `1.`.
 */
describe('an ordered list names its delimiter in the HTML', () => {
  it('writes data-delim for a `)` list', () => {
    expect(carveToHtml('1) first\n2) second\n')).toBe('<ol data-delim=")">\n  <li>first</li>\n  <li>second</li>\n</ol>')
  })

  it('writes nothing for the default `.`', () => {
    expect(carveToHtml('1. first\n2. second\n')).not.toContain('data-delim')
  })

  it('writes nothing on a bullet list', () => {
    expect(carveToHtml('- a\n')).not.toContain('data-delim')
  })

  it('trails type and start, which are structural too', () => {
    expect(carveToHtml('c) gamma\nd) delta\n')).toContain('<ol type="a" start="3" data-delim=")">')
  })

  it('leads the authored attributes, being structural', () => {
    expect(carveToHtml('{k=v .attr}\n1) first\n')).toContain('<ol data-delim=")" k="v" class="attr">')
  })

  it('is derived per list, so a nested list carries its own', () => {
    expect(carveToHtml('1. outer\n\n   1) inner\n')).toBe(
      '<ol>\n  <li>outer\n    <ol data-delim=")">\n      <li>inner</li>\n    </ol>\n  </li>\n</ol>',
    )
  })

  it('survives a render and import cycle', () => {
    const source = carveToCarve('1) one\n2) two\n')
    expect(carveToCarve(htmlToCarve(carveToHtml(source)).value)).toBe(source)
  })
})
