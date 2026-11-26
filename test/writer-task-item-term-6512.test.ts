import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

// carve#6512: a description list opened on the marker line takes its descriptions at its own column (C2-B-067),
// behind a task box or glued attributes, which do not move the item's content column (C2-B-229, C2-L-051).
describe('C2-B-067, C2-B-229: a term on the marker line of a task item keeps its description (carve#6512)', () => {
  it.each([
    '- [ ] :: A long term\n         continued\n      : The description.\n',
    '- [x] :: A\n      : D\n      : E\n',
    '1. [x] :: T\n          c\n       : D\n',
    '> - [ ] :: A long term\n>          continued\n>       : The description.\n',
    '- [ ] :: A\n      : D\n- [ ] b\n',
    '-{.c} :: A\n      : D\n',
    '-{.c} [ ] :: A\n          : D\n',
  ])('formats %j to itself', (source) => {
    expect(format(source)).toBe(source)
  })

  it.each([
    '- [ ] :: A\n      : D\n\n  more\n',
    '- [ ] :: A\n      : D\n\n  - n\n',
  ])('keeps the tree of %j', (source) => {
    const out = format(source)
    expect(treesEqual(parse(out), parse(source))).toBe(true)
    expect(format(out)).toBe(out)
  })
})
