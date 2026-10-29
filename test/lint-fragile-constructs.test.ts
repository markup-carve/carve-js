import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/index.js'

const found = (rule: string, source: string): Array<[number, number]> =>
  lintCarve(source).filter((w) => w.rule === rule).map((w) => [w.line, w.column])

// markup-carve/carve#3992: warnings for spellings that parse, but not as a reader expects.
describe('block-opener-overindented', () => {
  const at = (source: string) => found('block-opener-overindented', source)

  it.each([
    ['  # h\n', [[1, 3]]],
    ['para\n\n   ***\n', [[3, 4]]],
    ['  ```\n  code\n  ```\n', [[1, 3]]],
    ['  | a |\n  | b |\n', [[1, 3]]],
    ['para\n  # h\n', [[2, 3]]],
    ['\t# h\n', [[1, 2]]],
    ['>   # h\n', [[1, 5]]],
    ['> q\n>   # h\n', [[2, 5]]],
    ['> x\n>\n>  | a |\n>  | b |\n', [[3, 4]]],
    [':: t\n: d\n\n    # h\n', [[4, 5]]],
    ['x[^a]\n\n[^a]: n\n\n      # h\n', [[5, 7]]],
    ['::: note\n  # h\n:::\n', [[2, 3]]],
    ['  :: t\n  : d\n', [[1, 3]]],
  ])('reports %j', (source, expected) => {
    expect(at(source)).toEqual(expected)
  })

  it.each([
    '# h\n',
    '> # h\n',
    '> > # h\n',
    '  - a\n  - b\n',
    ' 9. nine\n10. ten\n',
    '- a\n\n      # h\n',
    'para\n  text\n',
    '  %% note\n',
    '  {.x}\npara\n',
    '```\n  # h\n```\n',
    '- a\n+\n# h\n',
  ])('is quiet on %j', (source) => {
    expect(at(source)).toEqual([])
  })

  it('names the owner and the distance past its column', () => {
    const [w] = lintCarve('> q\n>   # h\n').filter((x) => x.rule === 'block-opener-overindented')
    expect(w!.message).toContain('2 columns past the content column of its block quote')
  })
})

describe('emphasis-marker-before-attributes', () => {
  const at = (source: string) => found('emphasis-marker-before-attributes', source)

  it.each([
    ['a*{.x} b*\n', [[1, 2]]],
    ['**{.x}\n', [[1, 2]]],
    ['x/{.a} y_{.b} z~{.c} w={.d}\n', [[1, 2], [1, 9], [1, 16], [1, 23]]],
    ['{*a*{.x} b*}\n', [[1, 4]]],
    ['*a *b*{.x}\n', [[1, 6]]],
    ['*a\nb *c*{.x}\n', [[2, 5]]],
    ['| a*{.x} |\n', [[1, 4]]],
    ['é*{.x}\n', [[1, 2]]],
  ])('reports %j', (source, expected) => {
    expect(at(source)).toEqual(expected)
  })

  it.each([
    '*a*{.x}\n',
    '{*a*}{.x}\n',
    '*a {*b*}{.x}*\n',
    '/a/{.x} _b_{.y} ~c~{.z} =d={.w}\n',
    'a\\*{.x}\n',
    '*a \\* b*{.x}\n',
    '*a /b/{.y} c*{.x}\n',
    '`a*{.x}`\n',
    '*a `*` b*{.x}\n',
    '*a $`*` b*{.x}\n',
    'a * {.x}\n',
    'a*{???}\n',
  ])('is quiet on %j', (source) => {
    expect(at(source)).toEqual([])
  })

  it('names which reading applies', () => {
    expect(lintCarve('a*{.x} b*\n').find((w) => w.rule === 'emphasis-marker-before-attributes')!.message)
      .toContain('stay text')
    expect(lintCarve('*a *b*{.x}\n').find((w) => w.rule === 'emphasis-marker-before-attributes')!.message)
      .toContain('strong span that opens at line 1, column 1')
  })

  it('reports UTF-16 offsets into CRLF source', () => {
    const [w] = lintCarve('x\r\né*{.x}\r\n').filter((x) => x.rule === 'emphasis-marker-before-attributes')
    expect([w!.line, w!.column, w!.start, w!.end]).toEqual([2, 2, 4, 9])
  })
})
