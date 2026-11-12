import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

const lines = (...rows: string[]): string => rows.join('\n') + '\n'

// Each expected import renders what cmark-gfm 0.29.0.gfm.13 renders for its input
// (CARVE-P9-074).
describe('a reference definition that opens a list item (carve#6017)', () => {
  it('takes the blank line after it along, so the item stays tight', () => {
    expect(markdownToCarve(lines('- [r]: https://e', '', '  a', '  b'))).toBe(lines('- a', '  b', '', '[r]: https://e'))
    expect(markdownToCarve(lines('- [r]: https://e', '', '  a', '- z'))).toBe(lines('- a', '- z', '', '[r]: https://e'))
  })

  it('does the same inside a quote, after a chained definition and under two markers', () => {
    expect(markdownToCarve(lines('> - [r]: https://e', '>', '>   a', '>   b'))).toBe(lines('> - a', '>   b', '', '[r]: https://e'))
    expect(markdownToCarve(lines('- [r]: https://e', '  [s]: https://f', '', '  a [x][s]')))
      .toBe(lines('- a [x][s]', '', '[r]: https://e', '', '[s]: https://f'))
    expect(markdownToCarve(lines('- - [r]: https://e', '', '    a [x][r]'))).toBe(lines('- - a [x][r]', '', '[r]: https://e'))
  })
})

describe('a reference definition in a quote inside a list item (carve#6018)', () => {
  it('keeps its destination a destination', () => {
    const carve = markdownToCarve(lines('- > a [x][r]', '  >', '  > [r]: https://e'))
    expect(carve).toBe(lines('- > a [x][r]', '', '[r]: https://e'))
    expect(carveToHtml(carve)).toContain('<a href="https://e">x</a>')
  })

  it('reads the quote at any item column and on the marker line', () => {
    expect(markdownToCarve(lines('10) > a [x][r]', '    >', '    > [r]: https://e'))).toBe(lines('10) > a [x][r]', '', '[r]: https://e'))
    expect(markdownToCarve(lines('- > [r]: https://e', '  >', '  > a [x][r]'))).toBe(lines('- > a [x][r]', '', '[r]: https://e'))
    expect(carveToHtml(markdownToCarve(lines('> - - > a [x][r]', '>     >', '>     > [r]: https://e'))))
      .toContain('<a href="https://e">x</a>')
  })

  it('keeps a definition-shaped continuation line as paragraph text', () => {
    expect(markdownToCarve(lines('- > b', '  > [r]:', '  > https://e'))).toBe(lines('- > b', '  > \\[r]:', '  > [https://e](https://e)'))
    expect(markdownToCarve(lines('- - > a', '    > [r]: https://e'))).toBe(lines('- - > a', '    > \\[r]: [https://e](https://e)'))
  })
})

describe('the line after a removed definition', () => {
  it('stays in the quote when it is a lazy line', () => {
    expect(markdownToCarve(lines('> a', '>', '> [r]: https://e', 'z [x][r]'))).toBe(lines('> a', '>', '> z [x][r]', '', '[r]: https://e'))
    expect(markdownToCarve(lines('- > a', '  >', '  > [r]: https://e', 'z [x][r]'))).toBe(lines('- > a', '  >', '  > z [x][r]', '', '[r]: https://e'))
  })

  it('leaves the list tight when it only looks like a definition', () => {
    expect(markdownToCarve(lines('- a', '[r]: https://e', '- n'))).toBe(lines('- a', '  \\[r]: [https://e](https://e)', '- n'))
  })
})
