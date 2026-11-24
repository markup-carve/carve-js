import { expect, it } from 'vitest'
import { formatWithDiagnostics, parse, writeWithDiagnostics } from '../src/index.ts'

// C2-W-088, C2-W-125 case two: the opener escape alone gives the quote its direction, so its right neighbor stays bare.
it.each([
  "\\/'_/", "x \\/'_/", '\\/"_/', "\\/'*/ y", "\\/']/", "\\*'_*", "\\*'-* y",
])('keeps the neighbor of a quote bare behind an escaped opener: %j', (source) => {
  const input = `${source}\n`
  expect(formatWithDiagnostics(input).source).toBe(input)
  expect(writeWithDiagnostics(parse(input)).source).toBe(input)
})
