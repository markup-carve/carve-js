import { describe, it, expect } from 'vitest'
import { lintCarve } from '../src/lint.js'

// References resolve by the shared ASCII-whitespace-normalized label key.
// A later definition colliding on that key is diagnosed because its body loses.

describe('normalized footnote references are not near misses', () => {
  it('resolves interior whitespace differences', () => {
    const w = lintCarve('see[^a  b].\n\n[^a b]: foo\n')
    expect(w.map((x) => x.rule)).not.toContain('unresolved-footnote')
  })

  it('resolves padded ends', () => {
    const w = lintCarve('see[^ a ].\n\n[^a]: foo\n')
    expect(w.map((x) => x.rule)).not.toContain('unresolved-footnote')
  })

  it('says nothing extra when the miss is not a near miss', () => {
    const w = lintCarve('see[^zzz].\n\n[^a]: foo\n')
    const miss = w.find((x) => x.rule === 'unresolved-footnote')
    expect(miss!.message).toBe(
      'Footnote reference [^zzz] has no matching definition; it renders as literal text.',
    )
  })

})

describe('two definitions differing only in whitespace are reported', () => {
  it('flags the pair and names both labels', () => {
    const w = lintCarve('see[^a b] and[^a  b].\n\n[^a b]: FIRST\n\n[^a  b]: SECOND\n')
    const clash = w.find((x) => x.rule === 'footnote-labels-differ-only-in-whitespace')
    expect(clash).toBeDefined()
    expect(clash!.message).toContain('[^a b]')
    expect(clash!.message).toContain('[^a  b]')
    expect(clash!.message).toContain('normalizes to the same key')
    expect(clash!.message).toContain('first definition wins')
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
