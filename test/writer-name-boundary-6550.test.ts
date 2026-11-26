import { expect, it } from 'vitest'
import { formatWithDiagnostics, parse, writeWithDiagnostics } from '../src/index.ts'

it.each(['#a\\_a_', '@a\\_a_'])('keeps a name-boundary escape out of the kind round: %j', (source) => {
  const input = `${source}\n`
  expect(formatWithDiagnostics(input).source).toBe(input)
  expect(writeWithDiagnostics(parse(input)).source).toBe(input)
})
