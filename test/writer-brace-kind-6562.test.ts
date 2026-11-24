import { expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

const cases: readonly [number, number, string, string][] = [
  [6562, 1, "1. //{/*{*/\\/{//", "1. //{/*{*{//\\{//}\n"],
  [6562, 2, "1. {{^{{^^}\\,,,{\\{^}", "1. {{^{{^^},,,{\\{^}\n"],
  [6562, 3, "> {^{^^}\\,{{,\\{,\\{,}", "> {^{^^},{{,\\{,\\{,}\n"],
  [6562, 4, "1. {^a{ {^{^^},{^^}^^\\{^}", "1. {^a{ {^{^^},{^^}^^\\{^}\n"],
  [6562, 5, "> {^{^^}\\{{^^}\\{\\},}\\{^}{^", "> {^{^^}{{^^}{},}\\{^}{^\n"],

]

it.each(cases)('carve#%i shape %i follows its Expected section and reads back', (_ticket, _shape, source, expected) => {
  const written = format(source)
  expect(written).toBe(expected)
  expect(treesEqual(parse(written), parse(source))).toBe(true)
})
