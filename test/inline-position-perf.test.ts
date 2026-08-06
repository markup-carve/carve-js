import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// Regression guard for the O(n^2) inline position mapping. pointAt() used to
// rescan the inline text from offset 0 on every token, so a token-dense or
// many-line paragraph was quadratic. The fix caches newline offsets per text
// and binary-searches. Positions must stay byte-for-byte identical.

describe('inline position mapping (perf + correctness)', () => {
  it('parses a many-line single paragraph into one node', () => {
    // The correctness half, at a size the everyday suite can afford. The
    // scaling half is the gated guard below.
    const source = Array.from(
      { length: 3000 },
      (_, i) => `continuation line ${i} of one big paragraph here`,
    ).join('\n')

    expect(parse(source).children).toHaveLength(1)
  })

  perfIt('parses a many-line single paragraph in linear time', () => {
    expectScansLinearly((input) => void parse(input), 'continuation line of one big paragraph\n', {
      label: 'many-line single paragraph',
      // A 38-byte fragment: 3000/12000 keeps the samples near the original
      // 3000-line input rather than building a 2 MB one.
      smallRepeats: 3000,
    })
  })

  perfIt('parses a quote-dense paragraph in linear time', () => {
    // Guard against indexing the growing text buffer (a ConsString) per char
    // in the smart-quote context check: it was O(n^2) with a catastrophic cliff
    // (32k single quotes took ~10s).
    expectScansLinearly((input) => void parse(input), "'w' ", { label: 'quote-dense paragraph' })
  })

  it('keeps correct line/column across soft breaks', () => {
    const doc = parse('para line one\nline two *b* end')
    const para = doc.children[0]!
    expect(para.type).toBe('paragraph')
    const strong = para.children!.find((c) => c.type === 'bold' || c.type === 'strong')!
    // `*b*` sits on the second line: starts at column 10, line 2.
    expect(strong.pos!.startLine).toBe(2)
    expect(strong.pos!.startColumn).toBe(10)
    expect(strong.pos!.endLine).toBe(2)
  })

  it('column continues from the source start column on the first line', () => {
    const doc = parse('ab *em* cd')
    const para = doc.children[0]!
    const strong = para.children!.find((c) => c.type === 'bold' || c.type === 'strong')!
    expect(strong.pos!.startLine).toBe(1)
    expect(strong.pos!.startColumn).toBe(4)
  })

  perfIt('parses an unterminated math backtick run in linear time', () => {
    expectScansLinearly((input) => void parse(input), '`', {
      prefix: '$',
      label: 'unterminated math backtick run',
    })
  })

  perfIt('parses repeated unclosed line-block openers in linear time', () => {
    expectScansLinearly((input) => void parse(input), '::: |\n\n', {
      label: 'repeated unclosed line-block openers',
      smallRepeats: 4000,
    })
  })

  perfIt('parses repeated emphasis openers with no closer in linear time', () => {
    expectScansLinearly((input) => void parse(input), '/a ', {
      label: 'repeated emphasis openers with no closer',
    })
  })
})
