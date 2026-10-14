import { expect, test } from 'vitest'
import { djotToCarve, djotToCarveWithLosses } from '../src/djot-import.js'
import controls from './fixtures/djot-root-code-container-losses.json'

test.each(controls)('root code warning follows Native Djot: $source', ({ source, lines }) => {
  const report = djotToCarveWithLosses(source)
  expect(report.value).toBe(djotToCarve(source))
  expect(report.losses.filter(loss => loss.message.includes('multiline code span contains a Carve container opener')).map(loss => loss.line)).toEqual(lines)
})
