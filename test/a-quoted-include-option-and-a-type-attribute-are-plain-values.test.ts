import { describe, expect, it } from 'vitest'
import { carveToAstJson, fromAstJson } from '../src/index.js'
import { parseDirective } from '../src/include-directive.js'

describe('a quoted include option value means what its unquoted form means', () => {
  it.each([
    ['@lines:"1-2"', { lines: { start: 1, end: 2 } }],
    ["@lines:'1-2'", { lines: { start: 1, end: 2 } }],
    ['@region:"demo"', { region: 'demo' }],
    ['@shift:"+1"', { shift: 1 }],
    ['@code:"js"', { code: { lang: 'js' } }],
  ])('%s', (option, expected) => {
    expect(parseDirective(`{{ a.txt ${option} }}`)).toMatchObject(expected)
  })

  it('keeps @cols names quoted', () => {
    expect(parseDirective('{{ a.csv @cols:"B,A" }}')?.cols).toEqual(['B', 'A'])
  })

  it('refuses an unterminated quote', () => {
    expect(parseDirective('{{ a.txt @lines:"1-2 }}')?.lines).toBeUndefined()
  })
})

describe('an attribute named type is not read as a node on ingest', () => {
  it.each(['{type=text}\na. alpha\n', '{type=paragraph}\npara\n', '{type=link}\n# H\n'])('%j', (source) => {
    const json = carveToAstJson(source)
    expect(() => fromAstJson(json)).not.toThrow()
  })
})
