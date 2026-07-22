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

    // Warm up first: the cold call carries JIT compilation (measured ~2.8x the
    // steady-state cost here), and under parallel-worker contention that was
    // enough to push a healthy linear parse past the bound and flake the suite.
    // Every other perf guard in this repo warms up for the same reason.
    parse(source)

    const start = performance.now()
    const doc = parse(source)
    const elapsed = performance.now() - start

    expect(doc.children).toHaveLength(1)
    // Linear parse is tens of ms warm; the previous quadratic took ~1s+ at this
    // size, so a generous bound separates them without timing flakiness.
    expect(elapsed).toBeLessThan(500)
  })

  it('parses a quote-dense paragraph in linear time', () => {
    // Guard against indexing the growing text buffer (a ConsString) per char
    // in the smart-quote context check: it was O(n^2) with a catastrophic cliff
    // (32k single quotes took ~10s). Linear is well under the bound below.
    const source = "'w' ".repeat(40000)

    const start = performance.now()
    parse(source)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(2000)
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

  it('parses an unterminated math backtick run in linear time', () => {
    const start = performance.now()
    parse('$' + '`'.repeat(20000))
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100)
  })

  it('parses repeated unclosed line-block openers in linear time', () => {
    const source = '::: |\n\n'.repeat(4000)

    const start = performance.now()
    parse(source)
    const elapsed = performance.now() - start

    // Isolated runs are well under 100ms on this input; the full Vitest suite
    // runs perf files concurrently, so keep the guard above the scheduler noise
    // while still separating the linear cache from the previous O(n^2) scan.
    expect(elapsed).toBeLessThan(500)
  })

  it('parses repeated emphasis openers with no closer in linear time', () => {
    const source = '/a '.repeat(20000)

    const start = performance.now()
    parse(source)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(500)
  })
})
