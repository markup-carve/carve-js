import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'

// Regression guard for the O(n^2) inline position mapping. pointAt() used to
// rescan the inline text from offset 0 on every token, so a token-dense or
// many-line paragraph was quadratic. The fix caches newline offsets per text
// and binary-searches. Positions must stay byte-for-byte identical.

describe('inline position mapping (perf + correctness)', () => {
  it('parses a 3000-line single paragraph in linear time', () => {
    const lines: string[] = []
    for (let i = 0; i < 3000; i++) {
      lines.push(`continuation line ${i} of one big paragraph here`)
    }
    const source = lines.join('\n')

    const start = performance.now()
    const doc = parse(source)
    const elapsed = performance.now() - start

    expect(doc.children).toHaveLength(1)
    // Linear parse is single-digit ms; the previous quadratic took ~1s+ at this
    // size, so a generous bound separates them without timing flakiness.
    expect(elapsed).toBeLessThan(500)
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
})
