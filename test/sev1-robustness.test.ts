import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

describe('Severity-1 robustness', () => {
  it('does not overflow on a large single paragraph (no array-spread DoS)', () => {
    // ~70k inline nodes in one paragraph. resolveHeadingIds runs
    // unconditionally in every public API; an unbounded `...spread` of the
    // node array (splice / push) overflowed V8's call-stack argument limit
    // (~65k), a RangeError DoS on ~140KB of input. All four APIs must return
    // a string instead of throwing.
    const big = 'a\n'.repeat(70000)
    for (const api of [carveToHtml, carveToMarkdown, carveToPlainText, carveToAnsi]) {
      let out: string | undefined
      expect(() => {
        out = api(big)
      }).not.toThrow()
      expect(typeof out).toBe('string')
    }
  })

  it('does not overflow on deeply nested inline brackets', () => {
    const links = '['.repeat(9000) + 'x' + '](u)'.repeat(9000)
    expect(() => carveToHtml(links)).not.toThrow()
    const spans = '['.repeat(9000) + 'x' + ']{.c}'.repeat(9000)
    expect(() => carveToHtml(spans)).not.toThrow()
  })

  it('does not overflow on deeply nested emphasis / critic', () => {
    expect(() => carveToHtml('/'.repeat(3000) + 'x' + '/'.repeat(3000))).not.toThrow()
  })

  it('an unterminated typed admonition stays literal, not swallowing ahead', () => {
    // grammar: `admonition = open … close`; no closer ahead → literal, like a
    // bare unterminated `:::` (PART 9 §12).
    expect(carveToHtml('intro\n\n::: note\nbody\n\nmore\n')).toBe(
      '<p>intro</p>\n<p>::: note\nbody</p>\n<p>more</p>',
    )
  })

  it('a terminated admonition still opens', () => {
    expect(carveToHtml('::: note\nbody\n:::\n')).toBe(
      '<aside class="admonition note">\n  <p>body</p>\n</aside>',
    )
  })

  it('normal nesting still renders', () => {
    expect(carveToHtml('/a *b* c/ and [t](u)')).toBe(
      '<p><em>a <strong>b</strong> c</em> and <a href="u">t</a></p>',
    )
  })
})
