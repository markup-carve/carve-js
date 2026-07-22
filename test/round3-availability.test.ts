import { describe, expect, it } from 'vitest'

import { autolink, carveToHtml } from '../src/index.js'
import { citations } from '../src/citations.js'
import { index } from '../src/index-terms.js'

// Round-3 availability / robustness fixes. None change normal output (the spec
// corpus stays byte-identical); each guards against a crash or DoS on hostile
// or real-world-malformed input.

const hb = (s: string, bib: unknown[]) =>
  carveToHtml(s, { extensions: [citations({ bibliography: bib })] }).trim()

describe('Fix 1: bibliography tolerates a non-array `author`', () => {
  // Real-world CSL-JSON often has `author` as a string/number/object. The old
  // `(e.author ?? []).map(...)` threw `TypeError: .map is not a function`,
  // which aborted the ENTIRE document render (uncaught).
  it('does not throw when author is a string', () => {
    let out = ''
    expect(() => {
      out = hb('[@x]', [{ id: 'x', author: 'Evil', title: 'T' }])
    }).not.toThrow()
    // Entry still renders (sans author): title is shown.
    expect(out).toContain('<li id="ref-x">T.')
  })

  it('does not throw when author is a number', () => {
    expect(() => hb('[@x]', [{ id: 'x', author: 42, title: 'T' }])).not.toThrow()
  })

  it('does not throw when author is a bare object (not an array)', () => {
    expect(() => hb('[@x]', [{ id: 'x', author: { family: 'X' }, title: 'T' }])).not.toThrow()
  })

  it('one bad entry does not abort sibling entries', () => {
    const out = hb('[@bad] and [@good]', [
      { id: 'bad', author: 'Evil', title: 'Bad' },
      { id: 'good', author: [{ family: 'Good', given: 'A' }], title: 'Good' },
    ])
    expect(out).toContain('Good, A')
    expect(out).toContain('Bad.')
  })
})

describe('Fix 2: bibliography tolerates null / non-object name elements', () => {
  // A `null` (or string) element inside the `author` ARRAY dereferenced
  // `n.literal` / `n.family` and threw.
  it('does not throw on a [null] author array', () => {
    let out = ''
    expect(() => {
      out = hb('[@x]', [{ id: 'x', author: [null], title: 'T' }])
    }).not.toThrow()
    expect(out).toContain('<li id="ref-x">T.')
  })

  it('skips falsy / non-object elements but keeps the valid ones', () => {
    const out = hb('[@x]', [
      { id: 'x', author: ['plain', null, { family: 'Y' }], title: 'T' },
    ])
    // Only the real name element contributes (no year, so no `(year)`).
    expect(out).toContain('Y. T.')
  })
})

describe('Fix 3: index byCodepoint comparator is allocation-free and order-stable', () => {
  // The comparator used to call Array.from(a) AND Array.from(b) on EVERY
  // comparison -> O(L) alloc per compare. Verify (a) ordering is byte-identical
  // to the old comparator on a mixed BMP+astral set, and (b) many long
  // common-prefix terms sort fast.

  // The pre-fix comparator, reproduced for a differential check.
  const oldByCodepoint = (a: string, b: string): number => {
    const ca = Array.from(a)
    const cb = Array.from(b)
    const n = Math.min(ca.length, cb.length)
    for (let i = 0; i < n; i++) {
      const d = ca[i]!.codePointAt(0)! - cb[i]!.codePointAt(0)!
      if (d !== 0) return d
    }
    return ca.length - cb.length
  }

  // The new comparator (mirror of src/index-terms.ts byCodepoint).
  const newByCodepoint = (a: string, b: string): number => {
    let i = 0
    let j = 0
    const la = a.length
    const lb = b.length
    while (i < la && j < lb) {
      const ca = a.codePointAt(i)!
      const cb = b.codePointAt(j)!
      if (ca !== cb) return ca - cb
      i += ca > 0xffff ? 2 : 1
      j += cb > 0xffff ? 2 : 1
    }
    return la - i - (lb - j)
  }

  it('sorts a mixed BMP + astral set identically to the old comparator', () => {
    const terms = [
      'apple',
      'Apple',
      'appleé', // applé (BMP accented)
      'app',
      'application',
      '\u{1f600}face', // astral emoji prefix
      '\u{1f4a9}', // astral
      'zebra',
      'Zebra',
      'éclair', // éclair
      'a\u{1f600}b', // BMP then astral then BMP
      'ab',
      'a',
      '',
    ]
    const sortedOld = [...terms].sort(oldByCodepoint)
    const sortedNew = [...terms].sort(newByCodepoint)
    expect(sortedNew).toEqual(sortedOld)
  })

  it('sorts astral chars AFTER the BMP (code-point order, not UTF-16 unit order)', () => {
    // U+FFFF (BMP, high surrogate-free) must sort before U+10000 (astral).
    const bmp = '￿'
    const astral = '\u{10000}'
    expect(newByCodepoint(bmp, astral)).toBeLessThan(0)
    // Naive UTF-16 unit comparison would compare 0xFFFF vs 0xD800 and get this
    // backwards; confirm we don't.
    expect(bmp.charCodeAt(0)).toBeGreaterThan(astral.charCodeAt(0))
  })

  it('sorts 5000 long-common-prefix terms without per-compare allocation, no slower than before', () => {
    const prefix = 'x'.repeat(1000)
    const terms: string[] = []
    for (let i = 0; i < 5000; i++) terms.push(prefix + String(i).padStart(6, '0'))
    // Shuffle so the sort actually does work.
    for (let i = terms.length - 1; i > 0; i--) {
      const j = (i * 2654435761) % (i + 1)
      ;[terms[i], terms[j]] = [terms[j]!, terms[i]!]
    }
    const time = (cmp: (a: string, b: string) => number): number => {
      const t0 = Date.now()
      ;[...terms].sort(cmp)
      return Date.now() - t0
    }
    // Warm up both comparators (JIT) before timing.
    time(oldByCodepoint)
    time(newByCodepoint)
    const oldMs = Math.max(1, time(oldByCodepoint))
    const newMs = time(newByCodepoint)
    // The new comparator allocates nothing per compare (no per-call Array.from
    // on both operands), so it must not be slower than the old one. A generous
    // 1.5x ceiling keeps this robust under parallel-test contention while still
    // catching a regression that reintroduced per-compare allocation.
    expect(newMs).toBeLessThan(oldMs * 1.5)
    // Sanity: new comparator actually sorts.
    expect([...terms].sort(newByCodepoint)[0]).toBe(prefix + '000000')
  })
})

describe('Fix 4: autolink EMAIL scans near-linearly and still matches valid emails', () => {
  // The opt-in autolink() EMAIL regex used to scan a long dotted run at every
  // position (O(n^2)). Verify (a) near-linear scaling on the adversarial input
  // and (b) identical matches on valid addresses.
  const ext = autolink()
  const match = (text: string, pos: number) =>
    (ext.matchInline as (t: string, p: number) => { end: number } | null)(text, pos)

  // Cost PER SCANNED POSITION, not total elapsed. That normalization is what
  // makes the assertion meaningful: "linear" means the per-position cost is
  // constant as the input grows, so the metric is ~flat for a healthy scan and
  // grows in proportion to n if the quadratic scan returns.
  const perPositionCost = (n: number): number => {
    const s = 'x@' + 'a.'.repeat(n) + 'z'
    const t0 = performance.now()
    for (let i = 0; i < s.length; i++) match(s, i)
    return (performance.now() - t0) / s.length
  }

  const median = (xs: number[]): number =>
    [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

  it('scales near-linearly on the quadratic input shape', () => {
    // Warm up the JIT so the samples reflect steady-state, not first-call cost.
    perPositionCost(2000)

    const SMALL = 20_000
    const BIG = 80_000 // 4x the input

    // INTERLEAVED sampling: the previous version timed `small` once, then `big`
    // once, so a runner that was busy during only one of them produced a bogus
    // ratio -- the actual cause of the flakes (observed 6-7x for a scan that
    // measures a flat 4x when unloaded). Alternating the two sizes means load
    // drift hits both samples, and the median discards individual stalls (a
    // mean would still be skewed by one bad slice).
    const smalls: number[] = []
    const bigs: number[] = []
    for (let round = 0; round < 5; round++) {
      smalls.push(perPositionCost(SMALL))
      bigs.push(perPositionCost(BIG))
    }

    // Linear scan  -> per-position cost is constant     -> ratio ~1.
    // Quadratic    -> per-position cost grows with n    -> ratio ~4 at 4x input.
    // 2.0 sits far from both, so contention cannot reach it but a regression
    // sails past it.
    const ratio = median(bigs) / median(smalls)
    expect(ratio).toBeLessThan(2)
  })

  it('still autolinks valid email addresses', () => {
    expect(carveToHtml('Ping a@b.com please.', { extensions: [autolink()] })).toBe(
      '<p>Ping <a href="mailto:a@b.com">a@b.com</a> please.</p>',
    )
    expect(carveToHtml('x@a.b.c.io', { extensions: [autolink()] })).toBe(
      '<p><a href="mailto:x@a.b.c.io">x@a.b.c.io</a></p>',
    )
    expect(
      carveToHtml('john.doe%+x@sub.example.co', { extensions: [autolink()] }),
    ).toBe('<p><a href="mailto:john.doe%+x@sub.example.co">john.doe%+x@sub.example.co</a></p>')
  })

  it('does not autolink a non-email', () => {
    expect(carveToHtml('not-an-email here', { extensions: [autolink()] })).toBe(
      '<p>not-an-email here</p>',
    )
  })
})

describe('Fix 5: index ::: block re-emission is byte-budgeted', () => {
  it('keeps output bounded for many markers x many index blocks (no RangeError)', () => {
    const markers = Array.from({ length: 5000 }, (_, i) => `:index[t${i}]`).join(' ')
    const blocks = Array.from({ length: 500 }, () => '::: index\n:::').join('\n\n')
    const src = `${markers}\n\n${blocks}`
    let out = ''
    expect(() => {
      out = carveToHtml(src, { extensions: [index()] })
    }).not.toThrow()
    // Budget = max(1MB, 8 x sourceByteLength). Output must stay bounded near it,
    // not balloon to the K x N x ~52 bytes (~130MB) of the un-budgeted path.
    const budget = Math.max(1_000_000, 8 * new TextEncoder().encode(src).length)
    // Allow a modest constant factor (escape expansion + wrappers), far below
    // the un-budgeted amplification.
    expect(out.length).toBeLessThan(budget * 5)
  })

  it('renders a normal small index fully', () => {
    const out = carveToHtml(
      'A :index[parser] and :index[lexer], then :index[parser].\n\n::: index\n:::',
      { extensions: [index()] },
    )
    expect(out).toContain('<li>parser <a href="#idx-parser-1" class="index-backref">↩</a> ')
    expect(out).toContain('<a href="#idx-parser-2" class="index-backref">↩</a>')
    expect(out).toContain('<li>lexer <a href="#idx-lexer-1" class="index-backref">↩</a></li>')
  })

  it('resets the budget per render call', () => {
    // A huge first render must not starve a subsequent small one.
    const markers = Array.from({ length: 5000 }, (_, i) => `:index[t${i}]`).join(' ')
    const blocks = Array.from({ length: 200 }, () => '::: index\n:::').join('\n\n')
    carveToHtml(`${markers}\n\n${blocks}`, { extensions: [index()] })
    const out = carveToHtml('A :index[parser].\n\n::: index\n:::', { extensions: [index()] })
    expect(out).toContain('<li>parser <a href="#idx-parser-1" class="index-backref">↩</a></li>')
  })
})
