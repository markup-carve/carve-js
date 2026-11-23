import { expect, it } from 'vitest'
import { format, parse, render, treesEqual, writeWithDiagnostics } from '../src/index.ts'

const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, field: unknown) => key === 'pos' ? undefined : field))

// carve#6443: C2-W-089, C2-W-097. The alt is spelled so that it reads back as the same image; the source spells it.
it('C2-W-097: a link tail in the alt is an atom, so its `]` is no partner and the `]` of `[^n]` stays bare', () => {
  const source = '![a [^n][a](b]) b](u "t")\n%% c\n'
  expect(format(source)).toBe(source)
  const written = writeWithDiagnostics(parse(source))
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(source)
})

it('C2-W-097, C2-I-073: an autolink in the alt is an atom, so the `[` before it has no partner and takes a backslash', () => {
  const source = '![\\[`` ` ``<https://e.x/]>](a\\)b)\n%% c\n'
  expect(format(source)).toBe(source)
  const written = writeWithDiagnostics(parse(source))
  expect(written.diagnostics).toEqual([])
  expect(written.source).toBe(source)
})

it('C2-W-089: where the clause spelling does not read back, a later form that does is taken', () => {
  for (const source of [
    '![[^n]`]`\\]](u "t")\n', '![[^n]<https://e.x/]>\\]](u)\n', '![\\[\\][a](b])](u)\n', '![a\\[[a](b])](u)\n',
    'x ![[^n\\][a][a](b])](u) y\n',
  ]) {
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics, source).toEqual([])
    expect(treesEqual(strip(parse(written.source)) as never, strip(tree) as never), source).toBe(true)
    expect(render(format(source)), source).toBe(render(source))
  }
})
