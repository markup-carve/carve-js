import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

// Every item after `99999.` is one column wider than the item that opened the
// list's column, so the definition prepass kept stacking a new container per
// item and walked the whole stack on every line (carve-js#2163).
const counting = (repeats: number): string =>
  Array.from({ length: repeats }, (_, i) => `${99_999 + i}. x`).join('\n') + '\n'

describe('an ordered list whose markers widen', () => {
  it('parses as one list', () => {
    const doc = parse(counting(3))
    expect(doc.children).toHaveLength(1)
    expect((doc.children[0] as { items: unknown[] }).items).toHaveLength(3)
  })

  perfIt('parses in linear time', () => {
    expectBuiltInputScansLinearly((input) => void parse(input), counting, {
      label: 'ordered items past a marker width change',
      smallRepeats: 2_000,
    })
  })
})
