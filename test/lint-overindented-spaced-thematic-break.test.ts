import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/index.js'

const at = (source: string): Array<[number, number]> =>
  lintCarve(source).filter((w) => w.rule === 'block-opener-overindented').map((w) => [w.line, w.column])

// markup-carve/carve#5003: a spaced thematic break is an opener like `***`.
describe('block-opener-overindented on a spaced thematic break', () => {
  it.each([
    ['  - - -\n', [[1, 3]]],
    ['  * * *\n', [[1, 3]]],
    [' - - - -\n', [[1, 2]]],
    ['para\n\n  * * *\n', [[3, 3]]],
    ['para\n  - - -\n', [[2, 3]]],
    ['> x\n>\n>   - - -\n', [[3, 5]]],
    ['x[^1]\n\n[^1]: n\n\n      - - -\n', [[5, 7]]],
    ['term\n: dd\n\n     * * *\n', [[4, 6]]],
  ])('reports %j', (source, expected) => {
    expect(at(source)).toEqual(expected)
  })

  it.each([
    '- - -\n',
    '> - - -\n',
    '  - - a\n',
    '  * * a\n',
    '  _ _ _\n',
    '  - -\n',
    '- a\n\n      - - -\n',
  ])('is quiet on %j', (source) => {
    expect(at(source)).toEqual([])
  })

  it('names the thematic break and its owner', () => {
    const [w] = lintCarve('  - - -\n').filter((x) => x.rule === 'block-opener-overindented')
    expect(w!.message).toContain('thematic break')
    expect(w!.message).toContain('the document')
  })
})
