import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const warnings = (source: string) => lintCarve(source).filter(warning => warning.rule === 'table-shaped-paragraph')

describe('table-shaped paragraph lint', () => {
  it('reports the authored pipe column', () => {
    expect(warnings('| a\n')[0]).toMatchObject({ line: 1, column: 1 })
    expect(warnings('> | a\n')[0]).toMatchObject({ line: 1, column: 3 })
  })

  it.each(['| a\n', '| a | b\n', '|= Name\n', '> | a\n'])(
    'reports an unfinished table-shaped line: %s', source => {
      expect(warnings(source)).toHaveLength(1)
    },
  )

  it.each(['|\n', '|   \n', '| a |\n', '|= Name |\n', 'some | prose\n'])(
    'leaves a line without an unfinished table shape alone: %s', source => {
      expect(warnings(source)).toHaveLength(0)
    },
  )
})
