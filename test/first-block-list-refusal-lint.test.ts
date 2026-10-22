import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const refused = (source: string) =>
  lintCarve(source).filter(w => w.rule === 'continuation-marker-refused').map(w => [w.line, w.column, w.message])

// markup-carve/carve#3482: the first-block form of a note or a description does not pull a column-0 list.
describe('a first-block plus above a column-0 list', () => {
  it.each([
    ['[^a]: +\n- a list\n', 1, 7, 'It remains text in the footnote.'],
    ['[^a]: +\n1. b\n', 1, 7, 'It remains text in the footnote.'],
    [':: t\n: +\n- a list\n', 2, 3, 'The description stays empty.'],
    [':: t\n: +\n1. b\n', 2, 3, 'The description stays empty.'],
  ])('%j is reported', (source, line, column, effect) => {
    expect(refused(source)).toEqual([[line, column, expect.stringContaining('a list')]])
    expect(refused(source)[0]![2]).toContain(effect)
  })

  // A first-block plus with no eligible block below is refused too (CARVE-P9-067).
  it.each([
    ['[^a]: +\n', 1, 7, 'end of the document'],
    ['[^a]: +\n\npara\n', 1, 7, 'blank line'],
    ['[^a]: +\n  - a\n', 1, 7, 'right of its column'],
    [':: t\n: +\n  - a\n', 2, 3, 'right of its column'],
  ])('%j with no eligible block is reported', (source, line, column, reason) => {
    expect(refused(source)).toEqual([[line, column, expect.stringContaining(reason)]])
  })

  it.each([
    '[^a]: +\npara\n',
    ':: t\n: a\n+\n- b\n',
    '[^a]: x\n+\n- b\n',
    ':: t\n: +\npara\n',
  ])('%j is silent', (source) => {
    expect(refused(source)).toEqual([])
  })
})
