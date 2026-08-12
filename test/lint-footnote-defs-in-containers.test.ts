import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/lint.js'
import { parse } from '../src/parse.js'

// The footnote-definition lint rules scanned raw source lines, so a definition
// inside a block quote or list item was invisible to them - while the parser
// had already collected it and the document rendered it (carve-js#1019). The
// scanner strips the same container prefixes the parser strips, and reports
// only labels the parser actually collected, so it can neither miss a real
// definition nor invent one.

const rules = (src: string) => lintCarve(src).map((w) => w.rule)

describe('footnote definitions inside containers reach the lint rules', () => {
  it('reports a duplicate inside a block quote', () => {
    const src = 'see[^a].\n\n> [^a]: one\n>\n> [^a]: two\n'
    expect(Object.keys(parse(src).footnoteDefs ?? {})).toEqual(['a'])
    expect(rules(src)).toContain('duplicate-footnote-definition')
  })

  it('reports a duplicate inside a list item', () => {
    expect(rules('see[^a].\n\n- [^a]: one\n- [^a]: two\n')).toContain(
      'duplicate-footnote-definition',
    )
  })

  it('reports a whitespace-only twin inside a block quote', () => {
    const src = 'see[^a b] and[^a  b].\n\n> [^a b]: one\n>\n> [^a  b]: two\n'
    expect(Object.keys(parse(src).footnoteDefs ?? {})).toEqual(['a b', 'a  b'])
    expect(rules(src)).toContain('footnote-labels-differ-only-in-whitespace')
  })

  it('points an unused nested definition at its own line, not line 1', () => {
    const w = lintCarve('text\n\n> [^a]: one\n')
    const unused = w.find((x) => x.rule === 'unused-footnote-definition')
    expect(unused).toBeDefined()
    expect(unused!.line).toBe(3)
  })

  it('leaves a clean nested definition silent', () => {
    expect(lintCarve('see[^a].\n\n> [^a]: one\n')).toEqual([])
  })

  it('still reports the flush-left cases', () => {
    expect(rules('see[^a].\n\n[^a]: one\n\n[^a]: two\n')).toContain(
      'duplicate-footnote-definition',
    )
  })

  it('reports only what the parser collected', () => {
    // Stripping prefixes line by line has no block context, so a marker on a
    // hard-wrapped prose line looks like a container to the scanner alone.
    // Whatever the scanner thinks, a label the parser did not collect produces
    // no warning - the two cannot disagree about what a definition is.
    const src = 'prose\n- not a definition, just a wrapped line\n'
    expect(Object.keys(parse(src).footnoteDefs ?? {})).toEqual([])
    expect(lintCarve(src)).toEqual([])
  })

  it('does not read an over-indented literal line as a definition', () => {
    // Indentation is kept when prefixes are stripped, precisely for this: the
    // line below is literal text, and a REAL definition for the same label
    // exists above it. Dropping the indent made it match, and the label check
    // could not tell the two apart - a false duplicate.
    const src = '[^a]: real\n\n- item\n\n      [^a]: literal\n'
    expect(Object.keys(parse(src).footnoteDefs ?? {})).toEqual(['a'])
    expect(rules(src)).not.toContain('duplicate-footnote-definition')
  })

  it('does not see a definition under an alphabetic list marker', () => {
    // KNOWN and deliberate: `stripContainerPrefixes` does not strip `a.`/`i.`
    // markers, so neither does this scanner. The parser collects the
    // definition, so the rules that read `footnoteDefs` still work; only the
    // line-scanning ones (duplicate, whitespace-twin) are blind here. Pinned
    // so the boundary is a decision rather than a surprise.
    const src = 'see[^x].\n\na. [^x]: one\na. [^x]: two\n'
    expect(Object.keys(parse(src).footnoteDefs ?? {})).toEqual(['x'])
    expect(rules(src)).not.toContain('duplicate-footnote-definition')
  })

  it('does not see a definition on an indented continuation line', () => {
    // The remaining half of the gap, pinned rather than left to be discovered.
    // The parser reaches this definition by tracking each container's CONTENT
    // COLUMN; this scanner has no block context, so it cannot tell an indented
    // definition from an indented literal line - and the test above shows what
    // happens when it guesses. Closing this means sharing the parser's
    // definition-site pass, not another line heuristic here.
    const src = 'see[^a].\n\n- item\n  [^a]: one\n  [^a]: two\n'
    expect(Object.keys(parse(src).footnoteDefs ?? {})).toEqual(['a'])
    expect(rules(src)).not.toContain('duplicate-footnote-definition')
  })

  it('does not treat a definition inside a code fence as one', () => {
    const src = 'text\n\n```\n[^a]: one\n[^a]: two\n```\n'
    expect(rules(src)).not.toContain('duplicate-footnote-definition')
  })
})
