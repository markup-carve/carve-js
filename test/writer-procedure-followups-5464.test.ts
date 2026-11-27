import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

describe('C2-W-125: case-one trials replace earlier repairs', () => {
  it('does not spread the kind of a brace trial to another brace', () => {
    const source = '1. {{^{,\\{\\{^^}{\\^^'
    const expected = '1. {{^{,{\\{^^}{^^\n'
    expect(format(source)).toBe(expected)
    const repair = writeTreeWithStats(parse(source), undefined, 'repair').output
    expect(repair.diagnostics).toEqual([])
    expect(repair.source).toBe('. {{^{,{\\{^^}{^^\n')
    expect(treesEqual(parse(expected), parse(source))).toBe(true)
  })

  it('takes out the content-start escape when the brace trial forms the node', () => {
    const source = '1. / /\\/{//{,b,}{*}{//}/{/{/}[ [//}{**} }/}/{*{*{//}*}/*/*z'
    // C2-W-088 (carve#6802) also escapes the unheld constructs behind the comparison stop.
    const expected = '1. / {/\\/\\{\\//}{,b,}{*}{//}{/{/{/}[ [\\//}{**} }/}/}{*{*{//}*}/*/*z\n'
    expect(format(source)).toBe(expected)
    const repair = writeTreeWithStats(parse(source), undefined, 'repair').output
    expect(repair.diagnostics).toEqual([])
    expect(repair.source).toBe(expected.replace(/^1\./, '.'))
    expect(treesEqual(parse(expected), parse(source))).toBe(true)
  })
})

it('C2-W-069: the braced emphasis already follows carve#6469', () => {
  const source = '- } /*}{/{//}//}}'
  expect(format(source)).toBe(`${source}\n`)
  expect(writeTreeWithStats(parse(source), undefined, 'repair').output.source).toBe(`${source}\n`)
})
