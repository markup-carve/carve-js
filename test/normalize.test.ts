// The `normalize` option of the formatter (C2-W-127): write as if the parse had no sidecar.
import { describe, expect, it } from 'vitest'
import { CarveOptionError, format, parse, render, treesEqual } from '../src/index.ts'

const SOURCE = ['::: >', 'A fenced quote.', ':::', '', '1. one', '2. two', '', '{table}', '```csv', 'a,b', '1,2', '```', '', '| x | y |', '+ more | |', ''].join('\n')

describe('normalize', () => {
  it('C2-W-127: without the option the formatter keeps the form the author chose', () => {
    expect(format(SOURCE)).toBe(SOURCE)
  })

  it('C2-W-127: with the option every spelling of C2-W-083 takes its default form', () => {
    expect(format(SOURCE, { normalize: true })).toBe(
      ['> A fenced quote.', '', '. one', '. two', '', '|= a |= b |', '| 1 | 2 |', '', '| x more | y |', ''].join('\n'),
    )
  })

  it('C2-W-127: the tree is the same, and a normalized document is stable with and without the option', () => {
    const normalized = format(SOURCE, { normalize: true })
    expect(treesEqual(parse(SOURCE), parse(normalized))).toBe(true)
    expect(format(normalized, { normalize: true })).toBe(normalized)
    expect(format(normalized)).toBe(normalized)
  })

  it('C2-W-127: it combines with alignTables', () => {
    expect(format('{table}\n```csv\nname,n\ntea,2\n```\n', { normalize: true, alignTables: true })).toBe('|= name |= n |\n| tea   | 2  |\n')
  })

  it('C2-H-137: normalize is an option of format only, and a boolean', () => {
    expect(() => render('x', { normalize: true } as never)).toThrow(CarveOptionError)
    expect(() => format('x', { normalize: 'yes' } as never)).toThrow(CarveOptionError)
  })
})
