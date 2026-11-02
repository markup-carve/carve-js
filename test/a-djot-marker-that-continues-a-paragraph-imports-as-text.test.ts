import { describe, expect, it } from 'vitest'
import { djotToCarve } from '../src/index.js'

// A Djot list item cannot interrupt a paragraph, so a marker on a continuation
// line is text: the importer keeps its spelling (carve#4951).
describe('a Djot marker on a paragraph continuation line', () => {
  it.each([
    'x\na. y\n',
    'x\n(a) y\n',
    'x\nb. c. y\n',
    'x\n1. a. y\n',
    'x\nJ. R. T\n',
    'x\n  a. y\n',
    '> x\n> a. y\n',
  ])('keeps %j', (djot) => {
    expect(djotToCarve(djot)).toBe(djot)
  })

  it('keeps a description body line as text', () => {
    expect(djotToCarve(': t\n\n  d\n  a. y\n')).toContain('\n   a. y\n')
  })

  it.each([
    ['x\n\na. y\n', 'x\n\na.  y\n'],
    ['# h\na. y\n', '# h\na.  y\n'],
    ['- x\na. y\n', '- x\n\na.  y\n'],
    ['- x\n> a. y\n', '- x\n> a.  y\n'],
    ['(a) y\n', 'a.  y\n'],
  ])('still rewrites a marker that starts a block: %j', (djot, carve) => {
    expect(djotToCarve(djot)).toBe(carve)
  })
})
