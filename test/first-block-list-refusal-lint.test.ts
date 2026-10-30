import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const refused = (source: string) =>
  lintCarve(source).filter(w => w.rule === 'continuation-marker-refused').map(w => [w.line, w.column, w.message])

// A first-block plus of a note or a description attaches a column-0 list (markup-carve/carve#4409).
describe('a first-block plus above a column-0 list', () => {
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
    '[^a]: +\n- a list\n',
    '[^a]: +\n1. b\n',
    ':: t\n: +\n- a list\n',
    ':: t\n: +\n1. b\n',
    '[^a]: +\npara\n',
    ':: t\n: a\n+\n- b\n',
    '[^a]: x\n+\n- b\n',
    ':: t\n: +\npara\n',
  ])('%j is silent', (source) => {
    expect(refused(source)).toEqual([])
  })
})
