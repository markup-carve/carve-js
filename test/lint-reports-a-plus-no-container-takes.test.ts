import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/index.js'

const refused = (source: string): string[] =>
  lintCarve(source)
    .filter((warning) => warning.rule === 'continuation-marker-refused')
    .map((warning) => `${warning.line}:${warning.column}`)

// markup-carve/carve#3421, #3529, #3530: every `+` the renderer leaves as text is reported.
describe('continuation-marker-refused for a plus no container takes', () => {
  const reported: Array<[string, string[]]> = [
    // The top-level twin of corpus 630-4.
    ['q\n+\n- s\n', ['2:1']],
    ['q\n+\n1. s\n', ['2:1']],
    // Corpus 630-5, docs/validation.md.
    ['> q\n>   +\n> para\n', ['2:5']],
    ['> - a\n>   +\n', ['2:5']],
    // Corpus 649-4 and 649-5: a quoted follower right of the opener line.
    ['> > +\n  > q\n', ['1:5']],
    ['- a\n  > > +\n    > q\n', ['2:7']],
    ['> +\n  > q\n', ['1:3']],
  ]
  for (const [source, expected] of reported) {
    it(`reports ${JSON.stringify(source)}`, () => {
      expect(refused(source)).toEqual(expected)
    })
  }

  const quiet = [
    'q\n+\npara\n',
    '```\nq\n+\n- s\n```\n',
    '> q\n> +\n> para\n',
    '> > q\n> +\n> > r\n',
    '> +\n> q\n',
    '- > +\n  > q\n',
    '- > +\n> q\n',
  ]
  for (const source of quiet) {
    it(`does not report ${JSON.stringify(source)}`, () => {
      expect(refused(source)).toEqual([])
    })
  }

  it('names the list item that keeps the plus as text', () => {
    const [warning] = lintCarve('> - a\n>   +\n').filter((w) => w.rule === 'continuation-marker-refused')
    expect(warning?.message).toContain('remains text in the list item')
  })
})
