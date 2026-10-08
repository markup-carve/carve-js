import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, parseDirective, renderHtml, resolve } from '../src/index.js'

// carve#2778: a backslash before ASCII punctuation yields that character, as in
// a quoted attribute value; before anything else it stays path text.
describe('a quoted include path takes the attribute escape set', () => {
  it.each([
    ['an escaped quote', String.raw`{{ "a\"b.crv" }}`, 'a"b.crv'],
    ['an escaped backslash', String.raw`{{ "a\\b.crv" }}`, String.raw`a\b.crv`],
    ['an escaped dot', String.raw`{{ "a\.crv" }}`, 'a.crv'],
    ['an escaped hash', String.raw`{{ "a\#b.crv" }}`, 'a#b.crv'],
    ['a backslash before a letter', String.raw`{{ "notes\new.crv" }}`, String.raw`notes\new.crv`],
    ['a backslash before a digit', String.raw`{{ "a\101.crv" }}`, String.raw`a\101.crv`],
  ])('%s', (_label, source, path) => {
    expect(parseDirective(source)?.path).toBe(path)
  })

  it('the expander opens the decoded path, not the spelled one', () => {
    const source = String.raw`{{ "a\.crv" }}`
    const doc = parse(source, { positions: true })
    const files: Record<string, string> = { 'a.crv': 'decoded', [String.raw`a\.crv`]: 'kept' }
    const result = expandIncludes(doc, source, { resolve: (path) => files[path] ?? null })
    expect(result.warnings).toEqual([])
    expect(renderHtml(resolve(result.doc))).toBe('<p>decoded</p>')
  })
})
