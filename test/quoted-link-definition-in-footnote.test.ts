import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('quoted link definitions in footnote bodies', () => {
  for (const source of [
    '[^n]: a\n\n    > [r]: /x\n[x][r]\n',
    '[^n]: a\n    > [r]: /x\n[x][r]\n',
    '[^n]: a\n  > [r]: /x\n[x][r]\n',
  ]) {
    it(`registers the definition in ${JSON.stringify(source)}`, () => {
      expect(carveToHtml(source)).toContain('<a href="/x">x</a>')
    })
  }

  it('keeps a definition-shaped line in an open quote paragraph', () => {
    const html = carveToHtml('[^n]: a\n  > prose\n  > [r]: /x\n[x][r] [^n]\n')
    expect(html).toContain('[x][r]')
    expect(html).toContain('[r]: /x')
  })
})
