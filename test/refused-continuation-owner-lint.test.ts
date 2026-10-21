import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { lintCarve } from '../src/lint.js'

const refused = [
  ['footnote, one-column follower', '[^a]: intro\n+\n more\n\nsee[^a]\n', 1, 2],
  ['footnote, two-column follower', '[^a]: intro\n+\n  more\n\nsee[^a]\n', 1, 2],
  ['footnote, tab-indented follower', '[^a]: intro\n+\n\tmore\n', 1, 2],
  ['footnote, blank follower', 'x[^a]\n\n[^a]: note\n+\n\npara\n', 1, 4],
  ['surviving outer quote, outside follower', '> > q\n> +\npara\n', 3, 2],
  ['surviving outer quote, end of input', '> > q\n> +\n', 3, 2],
  ['surviving outer quote, shifted follower', '> > q\n> +\n>   para\n', 3, 2],
  ['quoted note, blank follower', '> [^a]: n\n> +\n\npara\n', 3, 2],
] as const

const refusalLocations = (source: string) => lintCarve(source)
  .filter(warning => warning.rule === 'continuation-marker-refused')
  .map(warning => [warning.line, warning.column])

describe('a refused marker at a surviving footnote or quote owner', () => {
  it.each(refused)('reports %s', (_name, source, column, line) => {
    expect(refusalLocations(source)).toEqual([[line, column]])
    expect(carveToHtml(source)).toContain('+')
  })

  it.each([
    '[^a]: intro\n+\nmore\n\nsee[^a]\n',
    '> > q\n> +\n> para\n',
    '- a\n  +\n\nx\n',
    '> > q\n>   +\n',
    '> > q\n> z\npara\n',
  ])('leaves an accepted marker or ordinary text silent: %j', source => {
    expect(refusalLocations(source)).toEqual([])
  })
})
