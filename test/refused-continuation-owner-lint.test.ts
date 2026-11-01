import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

const refused = [
  ['surviving outer quote, outside follower', '> > q\n> +\npara\n', 3, 2],
  ['surviving outer quote, end of input', '> > q\n> +\n', 3, 2],
  ['surviving outer quote, shifted follower', '> > q\n> +\n>   para\n', 3, 2],
  ['lazy quote inside list with no marker owner', '- x\n  > q\n  +\n', 3, 3],
  ['nested quote with a same-column list follower', '> > q\n> > +\n> > - s\n', 5, 2],
  ['quote with a same-column list follower', '> q\n> +\n> - s\n', 3, 2],
] as const

const refusedInNote = [
  ['footnote, one-column follower', '[^a]: intro\n+\n more\n\nsee[^a]\n', [2, 1]],
  ['footnote, two-column follower', '[^a]: intro\n+\n  more\n\nsee[^a]\n', [2, 1]],
  ['footnote, tab-indented follower', '[^a]: intro\n+\n\tmore\n', [2, 1]],
  ['footnote, blank follower', 'x[^a]\n\n[^a]: note\n+\n\npara\n', [4, 1]],
  ['quoted note, blank follower', '> [^a]: n\n> +\n\npara\n', [2, 3]],
] as const

const refusalLocations = (source: string) => lintCarve(source)
  .filter(warning => warning.rule === 'continuation-marker-refused')
  .map(warning => [warning.line, warning.column])

describe('a refused marker at a surviving footnote or quote owner', () => {
  it.each(refusedInNote)('reports %s in the note', (_name, source, location) => {
    expect(refusalLocations(source)).toEqual([location])
    if (source.includes('see[^a]') || source.includes('x[^a]')) expect(carveToHtml(source)).toContain('+')
  })
  it.each(refused)('reports %s', (_name, source, column, line) => {
    expect(refusalLocations(source)).toEqual([[line, column]])
    expect(carveToHtml(source)).toContain('+')
  })

  it.each([
    '[^a]: intro\n+\nmore\n\nsee[^a]\n',
    '> > q\n> +\n> para\n',
    '- a\n  z\n\nx\n',
    '> > q\n>   +\n',
    '> > q\n> z\npara\n',
    // PART 0 S2: a `+` at an item's content column is a letter (carve#4648).
    '- foo\n  - [ ] task\n    +\n  - x\n',
    '- foo\n  - [ ] task\n    +\n    q\n',
    '- a\n  +\n\nx\n',
  ])('leaves an accepted marker or ordinary text silent: %j', source => {
    expect(refusalLocations(source)).toEqual([])
  })
})
