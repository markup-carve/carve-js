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

  it.each([
    ':: t\n: a\n+\n- b\n',
    '[^a]: x\n+\n- b\n',
    ':: t\n: +\npara\n',
  ])('%j is silent', (source) => {
    expect(refused(source)).toEqual([])
  })
})
