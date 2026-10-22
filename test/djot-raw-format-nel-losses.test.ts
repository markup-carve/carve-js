import { expect, test } from 'vitest'
import { djotToCarve, djotToCarveWithLosses } from '../src/import/djot/djot-import.js'
import controls from './fixtures/djot-raw-format-nel-losses.json'

test('raw formats containing NEL report losses outside image alternatives', () => {
  for (const { source, lines } of controls) {
    const report = djotToCarveWithLosses(source)
    expect(report.value, source).toBe(djotToCarve(source))
    expect(report.losses.filter(loss => loss.message.includes('raw-format identifier containing U+0085')).map(loss => loss.line), source).toEqual(lines)
  }
})
