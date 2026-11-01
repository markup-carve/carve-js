import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/index.js'

const refused = (source: string): string[] =>
  lintCarve(source)
    .filter((warning) => warning.rule === 'continuation-marker-refused')
    .map((warning) => `${warning.line}:${warning.column}`)

// markup-carve/carve#3421, #3529, #3530: every `+` the renderer leaves as text is reported.
describe('continuation-marker-refused for a plus no container takes', () => {
  const reported: Array<[string, string[]]> = [
    // A refused stacked quote plus inside a host quote, like its top-level twin.
    ['> - > > +\n>   b\n', ['1:9']],
    ['> - - > +\n>   b\n', ['1:9']],
    ['- > +\n> q\n', ['1:5']],
    ['> > +\n  > q\n', ['1:5']],
    // Corpus 649-4 and 649-5: a quoted follower right of the opener line.
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
    '+\npara\n',
    'q\n+\n%% c\n',
    'q\n+\n- s\n',
    'q\n+\n1. s\n',
    '> q\n>   +\n> para\n',
    '```\nq\n+\n- s\n```\n',
    '> q\n> +\n> para\n',
    '> > q\n> +\n> > r\n',
    '> +\n> q\n',
    '- > +\n  > q\n',
    '> ```\n> q\n>   +\n> ```\n',
    '> %%%\n> q\n>   +\n> %%%\n',
    '%%%\nq\n+\n- s\n%%%\n',
    // PART 0 S2: a `+` at no open container's marker column is a letter (carve#4648).
    'q\n+\n| a |\n',
    'q\n+\n# h\n',
    'q\n+\n```\nx\n```\n',
    'q\n+\n> x\n',
    '+\n# h\n',
    '> - a\n>   +\n',
    'q\n+\n{.c}\npara\n',
  ]
  for (const source of quiet) {
    it(`does not report ${JSON.stringify(source)}`, () => {
      expect(refused(source)).toEqual([])
    })
  }

  it('names the list item that keeps the plus as text', () => {
    const [warning] = lintCarve('> - a\n> +\n>\n> b\n').filter((w) => w.rule === 'continuation-marker-refused')
    expect(warning?.message).toContain('remains text in the list item')
  })
})
