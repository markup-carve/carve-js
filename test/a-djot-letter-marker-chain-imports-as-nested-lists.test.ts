import { describe, expect, it } from 'vitest'
import { djotToCarve } from '../src/index.js'

// Djot takes one space after a letter `.` marker and Carve two (carve#4811), so
// the importer widens every marker of a line's chain, keeping its mask in step.
describe('a Djot letter marker chain', () => {
  it.each([
    ['- a. x\n', '- a.  x\n'],
    ['1. a. x\n', '1. a.  x\n'],
    ['> - a. x\n', '> - a.  x\n'],
    ['J. R. Tolkien\n', 'J.  R.  Tolkien\n'],
    ['a. b. x\n', 'a.  b.  x\n'],
    ['a. `c` x\n', 'a.  `c` x\n'],
  ])('widens %j', (djot, carve) => {
    expect(djotToCarve(djot)).toBe(carve)
  })

  it('keeps the escape on a period after a widened marker', () => {
    expect(djotToCarve('a. . x\n')).toBe('a.  \\. x\n')
  })

  it('does not widen a period that carries attributes', () => {
    expect(djotToCarve('a.{.c} x\n')).not.toContain('  x')
  })
})
