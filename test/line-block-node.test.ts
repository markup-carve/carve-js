import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/**
 * A line block is its own AST node (`line_block`), not a div carrying a
 * `.line-block` class.
 *
 * The class alone cannot express the difference: inside a `::: |` fence every
 * newline is a hard break, while a plain div an author gave that class keeps
 * soft breaks. With only the class to go on the writer could not tell which one
 * to emit, so it emitted the generic form and a formatted line block re-parsed
 * as an ordinary div - `parse(fmt(x)) == parse(x)` did not hold (issue 359).
 * The spec's profiles.md block vocabulary lists `line_block` for the same
 * reason: a profile denying it has to be able to name it.
 */
describe('line_block', () => {
  const source = '::: |\nRoses are red,\n  Violets are blue.\n:::\n'

  it('parses to its own node type', () => {
    const doc = parse(source)
    expect(doc.children[0]?.type).toBe('line_block')
  })

  it('still renders as a div carrying the line-block class', () => {
    // The class is part of the output contract, not of the AST.
    expect(carveToHtml(source)).toContain('<div class="line-block">')
  })

  it('keeps an author attribute alongside the structural class', () => {
    // The structural class trails the author's attributes, matching carve-php
    // and carve-rs.
    expect(carveToHtml(`{#verse}\n${source}`)).toContain('<div id="verse" class="line-block">')
    expect(carveToHtml(`{.foo #v}\n${source}`)).toContain('<div class="foo line-block" id="v">')
  })

  it('round-trips through the writer byte for byte', () => {
    expect(carveToCarve(source)).toBe(source)
  })

  it('preserves the leading indentation as spaces, not as a literal nbsp', () => {
    // The parser records the indent with the U+E000 placeholder, which the
    // writer used to resolve to a real nbsp - and a real nbsp re-parses as
    // literal text rather than as indentation.
    const out = carveToCarve(source)
    expect(out).toContain('\n  Violets')
    expect(out).not.toContain(' ')
  })

  it('is idempotent', () => {
    const once = carveToCarve(source)
    expect(carveToCarve(once)).toBe(once)
  })

  it('leaves a plain div that happens to carry the class as a div', () => {
    const div = '{.line-block}\n:::\nRoses are red,\n:::\n'
    expect(parse(div).children[0]?.type).toBe('div')
  })
})
