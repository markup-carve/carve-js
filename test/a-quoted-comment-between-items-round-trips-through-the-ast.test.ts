import { describe, expect, it } from 'vitest'
import { carveToAstJson, fromAstJson, parse } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

// carve-js#4403, PART 12: writing an AST read from the wire gives what fmt gives the parsed document.
describe('a quoted comment between list items round-trips through the AST', () => {
  it.each([
    '> - a\n>\n>   %% y\n> %% z\n> - c\n',
    '> - a\n>\n>   %% y\n> - c\n',
    '>> - a\n>>\n>>   %% y\n> > - c\n',
    '  >\n> %% y\n',
    '- p\n\n  > - a\n  >\n  >   %% y\n  > - c\n',
    '- p\n\n  > 1. a\n  >    %% y\n  >    %% z\n  > 1. c\n',
  ])('writes %j as fmt does', (source) => {
    expect(renderCarve(fromAstJson(carveToAstJson(source)))).toBe(renderCarve(parse(source)))
  })

  it('keeps the blanks around an indented comment in a quoted paragraph', () => {
    expect(renderCarve(parse('> a\n>\n>   %% y\n> b\n'))).toBe('> a\n>\n>   %% y\n>\n> b\n')
  })

  it('writes the corpus 945-4 shape with one blank, before the sibling', () => {
    expect(renderCarve(fromAstJson(carveToAstJson('> - a\n>\n>   %% y\n> %% z\n> - c\n'))))
      .toBe('> - a\n>   %% y\n> %% z\n>\n> - c\n')
  })
})
