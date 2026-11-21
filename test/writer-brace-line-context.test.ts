// A paragraph whose last line has the shape of an attribute line (C2-B-090) keeps its escape where the lines around
// the paragraph would make the bare line one: a block written directly below it, the attribute line of the paragraph
// itself above it (C2-B-137), or comment lines below it inside the paragraph.
import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

function roundTrip(source: string, normalize = false): string {
  const written = formatWithDiagnostics(source, { normalize })
  expect(written.diagnostics, source).toEqual([])
  expect(treesEqual(parse(written.source), parse(source)), `${source}\n->\n${written.source}`).toBe(true)
  expect(formatWithDiagnostics(written.source, { normalize }).source, written.source).toBe(written.source)
  return written.source
}

describe('the escape of a brace line by its context', () => {
  it('C2-W-088: an item paragraph above a nested block keeps the escape of its first brace', () => {
    expect(roundTrip('* {c}\\{c}\n  * x\n')).toBe('* \\{c}{c}\n  * x\n')
    expect(roundTrip('* \\{c}{c}\n  * x\n')).toBe('* \\{c}{c}\n  * x\n')
    for (const source of [
      '- {c}\\{c}\n - x\n', '- [ ] {c}\\{c}\n  * x\n', '* {c}\\{c}\n\n  * x\n', '> * {c}\\{c}\n>   * x\n',
      '* {#a}\\{c}\n  * x\n', '* {c}\\{c}\n  %% c\n  * x\n',
    ]) {
      for (const normalize of [false, true]) expect(roundTrip(source, normalize)).toMatch(/\\\{/)
    }
  })

  it('C2-B-137: a brace line below the attribute line of its paragraph keeps its escape', () => {
    expect(roundTrip('{#a}\n\\{.x}\n')).toBe('{#a}\n\\{.x}\n')
    for (const source of ['- {#a}\n  \\{.x}\n', '> {#a}\n> \\{.x}\n', '{#a}\n\\{.x}\n\np\n', '> > - {#a}\n> >   \\{c=v}{c="v"}\n> > 1. x\n']) {
      for (const normalize of [false, true]) expect(roundTrip(source, normalize)).toMatch(/\\\{/)
    }
  })

  it('C2-B-137: a brace line above comment lines of its paragraph keeps its escape', () => {
    expect(roundTrip('\\{.x}\n%% c\n')).toBe('\\{.x}\n%% c\n')
    expect(roundTrip('* [x] {\\.x}\n%% c\n* x\n')).toBe('* [x] \\{.x}\n  %% c\n* x\n')
    expect(roundTrip('> 1. \\{c=v}\n> %% c\n> * x\n')).toBe('> 1. \\{c=v}\n>    %% c\n>\n> * x\n')
  })

  it('C2-B-090: a brace line with nothing to apply to stays bare', () => {
    expect(roundTrip('* {c}\\{c}\n')).toBe('* {c}{c}\n')
    expect(roundTrip('* {c}\\{c}\n* x\n')).toBe('* {c}{c}\n* x\n')
    expect(roundTrip('{c}\\{c}\n\n* x\n')).toBe('{c}{c}\n\n* x\n')
    expect(roundTrip('{.x}\n%% c\n')).toBe('{.x}\n\n%% c\n')
  })
})
