import { expect, it } from 'vitest'
import { parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

it('C2-W-011: an escaped caret and brace in superscript remain spellable', () => {
  const source = String.raw`{^\^\{\^\\{\^\{x^}`
  const tree = parse(source)
  const written = writeWithDiagnostics(tree)
  expect(written.diagnostics).toEqual([])
  expect(treesEqual(parse(written.source), tree)).toBe(true)
})

it('C2-W-011: repeated braced openers in child text are repaired in order', () => {
  const source = String.raw`{^\^\{\^\\{\^\{x\^\{\^\\{\^\{y^}`
  const tree = parse(source)
  const written = writeWithDiagnostics(tree)
  expect(written.diagnostics).toEqual([])
  expect(treesEqual(parse(written.source), tree)).toBe(true)
})

it('C2-W-010: many repeated escaped openers are repaired within the linear work budget', () => {
  const source = `{^${String.raw`\^\{\^\\{\^\{x`.repeat(2048)}^}`
  const tree = parse(source)
  const written = writeWithDiagnostics(tree)
  expect(written.diagnostics).toEqual([])
  expect(treesEqual(parse(written.source), tree)).toBe(true)
}, 20_000)
