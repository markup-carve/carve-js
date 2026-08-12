import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/lint.js'

// Footnote labels are matched EXACTLY (PART 9 §16), which makes two failures
// possible that a reader cannot see in the source: a reference that misses its
// definition by a space, and two definitions that differ only by one. Djot
// avoids both by normalizing labels, at the cost of merging identifiers -
// which silently drops one definition's content and emits duplicate ids.
// Carve keeps the identifiers apart and says so, so these rules are what make
// the strict rule livable.

describe('a near-miss footnote reference names the definition it missed', () => {
  it('names a definition differing by interior whitespace', () => {
    const w = lintCarve('see[^a  b].\n\n[^a b]: foo\n')
    const miss = w.find((x) => x.rule === 'unresolved-footnote')
    expect(miss).toBeDefined()
    expect(miss!.message).toContain('[^a b] differs only in whitespace')
    expect(miss!.message).toContain('matched exactly')
  })

  it('names a definition differing by padded ends', () => {
    const w = lintCarve('see[^ a ].\n\n[^a]: foo\n')
    const miss = w.find((x) => x.rule === 'unresolved-footnote')
    expect(miss!.message).toContain('[^a] differs only in whitespace')
  })

  it('counts them when several definitions are near misses', () => {
    const w = lintCarve('see[^a  b].\n\n[^a b]: one\n\n[^ a b ]: two\n')
    const miss = w.find((x) => x.rule === 'unresolved-footnote')
    expect(miss!.message).toContain('2 definitions differ from it only in whitespace')
  })

  it('says nothing extra when the miss is not a near miss', () => {
    const w = lintCarve('see[^zzz].\n\n[^a]: foo\n')
    const miss = w.find((x) => x.rule === 'unresolved-footnote')
    expect(miss!.message).toBe(
      'Footnote reference [^zzz] has no matching definition; it renders as literal text.',
    )
  })

  it('keeps the rule id, so a consumer keying on it is unaffected', () => {
    const w = lintCarve('see[^a  b].\n\n[^a b]: foo\n')
    expect(w.map((x) => x.rule)).toContain('unresolved-footnote')
  })
})

describe('two definitions differing only in whitespace are reported', () => {
  it('flags the pair and names both labels', () => {
    const w = lintCarve('see[^a b] and[^a  b].\n\n[^a b]: FIRST\n\n[^a  b]: SECOND\n')
    const clash = w.find((x) => x.rule === 'footnote-labels-differ-only-in-whitespace')
    expect(clash).toBeDefined()
    expect(clash!.message).toContain('[^a b]')
    expect(clash!.message).toContain('[^a  b]')
    expect(clash!.message).toContain('two separate footnotes')
  })

  it('points at the second definition, which is the one to change', () => {
    const w = lintCarve('see[^a b] and[^a  b].\n\n[^a b]: FIRST\n\n[^a  b]: SECOND\n')
    const clash = w.find((x) => x.rule === 'footnote-labels-differ-only-in-whitespace')!
    expect(clash.line).toBe(5)
  })

  it('does not fire on identical labels, which are already a duplicate', () => {
    const w = lintCarve('see[^a].\n\n[^a]: one\n\n[^a]: two\n')
    expect(w.map((x) => x.rule)).toContain('duplicate-footnote-definition')
    expect(w.map((x) => x.rule)).not.toContain('footnote-labels-differ-only-in-whitespace')
  })

  it('does not fire on labels that differ by more than whitespace', () => {
    const w = lintCarve('see[^a] and[^b].\n\n[^a]: one\n\n[^b]: two\n')
    expect(w.map((x) => x.rule)).not.toContain('footnote-labels-differ-only-in-whitespace')
  })

  it('leaves a clean document silent', () => {
    expect(lintCarve('see[^a b].\n\n[^a b]: foo\n')).toEqual([])
  })
})
