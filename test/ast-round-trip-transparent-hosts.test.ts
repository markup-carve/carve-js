import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, fromAstJson, parse } from '../src/index.js'
import { readbackTree, renderCarve } from '../src/render-carve.js'

const cases = [
  ['list quote ownership', '- > +\n  %% c\n'],
  ['quote comment placement', '> a\n> +\n %% c\nz\n'],
  ['description comment gap', ':: t\n: a\n  +\n  %% c\n  %% z\n'],
  ['hoisted note follower', '> [^n]: +\n> %% c\n> %% z\n'],
  ['quoted list sibling', '- > +\n  %% c\n- z\n'],
  ['quote on a list marker line', '- > %% a\n  > +\n%% c\nz\n'],
  ['nested quote comment', '> > +\n> %% c\n'],
  ['comment after a quoted list', '> - +\n  > %% c\n'],
  ['description comment before a list', ':: t\n: a\n  +\n  %% c\n  - z\n'],
  ['hoisted note with a transparent paragraph line', '- > [^n]: +\n  > %% c\n  > z\n'],
] as const

describe('transparent comments through AST JSON', () => {
  for (const [name, source] of cases) {
    it(`keeps the ${name} tree and HTML`, () => {
      const direct = renderCarve(parse(source))
      const through = renderCarve(fromAstJson(carveToAstJson(source)))
      expect(through).toBe(direct)
      expect(readbackTree(through)).toBe(readbackTree(source))
      expect(carveToHtml(through)).toBe(carveToHtml(source))
    })
  }
})

describe('quotes after a consumed plus', () => {
  it.each([
    '- > a\n  +\n  %% c\n- z\n',
    '> :: t\n> : a\n> +\n> %% c\n> z\n',
  ])('keeps the AST owner and HTML for %j', (source) => {
    const through = renderCarve(fromAstJson(carveToAstJson(source)))
    expect(readbackTree(through)).toBe(readbackTree(source))
    expect(carveToHtml(through)).toBe(carveToHtml(source))
  })
})
