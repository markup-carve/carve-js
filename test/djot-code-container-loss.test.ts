import { expect, test } from 'vitest'
import { djotToCarveWithLosses } from '../src/djot-import.js'

test.each(['::: warning Title', '::: [x]', ':::'])('reports a container opener inside root Djot code: %s', marker => {
  const source = `\`a\n${marker}\nb\``
  expect(djotToCarveWithLosses(source).losses).toContainEqual({
    code: 'structure-unspellable',
    message: 'A multiline code span contains a Carve container opener on a continuation line.',
    line: 1,
  })
})

test('a line block marker remains in the code span', () => {
  expect(djotToCarveWithLosses('`a\n| b`').losses).toEqual([])
})

test('a code span after paragraph text still reports a container opener', () => {
  expect(djotToCarveWithLosses('x `a\n::: warning\nb`').losses).toContainEqual({
    code: 'structure-unspellable',
    message: 'A multiline code span contains a Carve container opener on a continuation line.',
    line: 1,
  })
})
