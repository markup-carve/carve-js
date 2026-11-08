import { describe, expect, it } from 'vitest'
import { carveToAstJson, fromAstJson, parse } from '../src/index.js'
import { renderCarve } from '../src/render-carve.js'

describe('a quoted continuation after an erased comment', () => {
  it.each([
    ['> a\n> %%\tx\n> b\n', '> a\n> %% \tx\n> b\n'],
    ['> a\n> %% c\n  b\n', '> a\n> %% c\n> b\n'],
    ['> :: term\n> :  intro\n> %% c\n>   more\n', '> :: term\n> : intro\n> %% c\n>   more\n'],
  ])('keeps its quote marker through the AST', (source, expected) => {
    expect(renderCarve(parse(source))).toBe(expected)
    expect(renderCarve(fromAstJson(carveToAstJson(source)))).toBe(expected)
  })
})
