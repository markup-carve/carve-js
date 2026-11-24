// carve-js#5201: the writer gates on four tokens, after carve-js#5547 dropped the hyphen backslashes beside a quote.
import { expect, it } from 'vitest'
import { format, parse } from '../src/index.ts'
import { checkWriter, referenceForm } from './support/writer-checks.ts'

// C2-W-088, C2-W-125 case two: escaping the kind `{-` already gives the quote the tree's direction, so its neighbor takes none.
it.each([
  ['x\\{-"-}', 'x\\{-"-}'],
  ["x\\{-'-}", "x\\{-'-}"],
  ['x{\\-"-}', 'x\\{-"-}'],
  ['x{-"\\-}', 'x\\{-"-}'],
  ["x{-'\\-}", "x\\{-'-}"],
  ['\\{+"+}', '\\{+"+}'],
])('C2-W-088: the reference leaves the closer beside a quote bare %j', (input, form) => {
  expect(format(input)).toBe(`${form}\n`)
  expect(referenceForm(form, parse(input))).toEqual({ form })
  expect(checkWriter(input)).toBeNull()
})

// C2-W-125 case two: where the escaped kinds leave the quote reading the other way, its neighbor still takes the backslash.
it.each([
  ['x<\\="[', 'x\\<="\\['],
  ['x<\\="{*', 'x\\<="\\{*'],
])('C2-W-125: the neighbor of a quote still read the other way %j', (input, form) => {
  expect(referenceForm(form, parse(input))).toEqual({ form })
  expect(checkWriter(input)).toBeNull()
})
