import { expect, it } from 'vitest'
import { parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

it('C2-W-011: an escaped caret and brace in superscript remain spellable', () => {
  const source = String.raw`{^\^\{\^\\{\^\{x^}`
  const tree = parse(source)
  const written = writeWithDiagnostics(tree)
  expect(written.diagnostics).toEqual([])
  expect(treesEqual(parse(written.source), tree)).toBe(true)
})
