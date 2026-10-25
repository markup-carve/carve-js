import { expect, it } from 'vitest'
import { djotToCarve, migrateDjot, parse } from '../src/index.js'

it('recovers dotted shorthand parts on a heading', () => {
  const result = migrateDjot('{#ch1.1}\n# Head\n')
  expect(result.value).toBe('{#ch1 .1}\n# Head\n')
  const heading = parse(result.value).children[0]
  expect(heading?.type).toBe('heading')
  expect(heading?.attrs?.id).toBe('ch1')
  expect(heading?.attrs?.classes).toEqual(['1'])
})

it('keeps leading digit identifiers on blocks and inline spans', () => {
  expect(djotToCarve('{#1start .2part}\n# Head\n')).toBe('{#1start .2part}\n# Head\n')
  expect(djotToCarve('Word{#1start .2part}\n')).toBe('[Word]{#1start .2part}\n')
})

it('drops only rejected shorthand parts and names each attribute', () => {
  const result = migrateDjot('{.good #bad!id .bad?class}\n# Head\n')
  expect(result.value).toBe('{.good}\n# Head\n')
  expect(result.report.diagnostics.filter(row => row.code === 'djot-attribute-dropped').map(row => row.message)).toEqual([
    'Djot attribute id could not be represented in Carve and was dropped.',
    'Djot attribute class could not be represented in Carve and was dropped.',
  ])
})

it('recovers dotted and rejected inline attributes without losing the span', () => {
  const result = migrateDjot('Word{#part.2 .bad?class}\n')
  expect(result.value).toBe('[Word]{#part .2}\n')
  expect(result.report.diagnostics.some(row => row.code === 'djot-attribute-dropped' && row.message.includes('class'))).toBe(true)
})
