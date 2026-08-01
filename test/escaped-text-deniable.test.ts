import { describe, expect, it } from 'vitest'

import { Profile, ProfileViolationError, canonicalType, carveToHtml } from '../src/index.js'

/**
 * `escaped_text` is in the normative inline vocabulary in the spec's
 * profiles.md, so a profile can name it. carve-js folded it to `text` in
 * `canonicalType()`, which made `denyInline(['escaped_text'])` do nothing at
 * all - no violation, no change in output (carve-js#474).
 *
 * A silent no-op is the specific failure the vocabulary exists to prevent: a
 * host restricting untrusted input names a type, gets no error, and the
 * construct is still there.
 */
describe('escaped_text is deniable', () => {
  it('keeps its own canonical name rather than folding into text', () => {
    expect(canonicalType('escaped_text')).toBe('escaped_text')
  })

  it('still folds smart_punctuation, which profiles.md excludes', () => {
    // The neighbouring fold is correct and must not be swept away with this
    // one: profiles.md lists the types it does NOT include, and
    // smart_punctuation is on that list while escaped_text is not.
    expect(canonicalType('smart_punctuation')).toBe('text')
  })

  it('reports a violation instead of ignoring the deny', () => {
    const profile = Profile.full().denyInline(['escaped_text']).onDisallowed('error')
    let violations: { nodeType: string }[] = []
    try {
      carveToHtml('A \\*x\\* here.', { profile })
      throw new Error('denying escaped_text raised nothing')
    } catch (error) {
      expect(error).toBeInstanceOf(ProfileViolationError)
      violations = (error as ProfileViolationError).violations
    }
    // `error` raises on the first violation, so one entry, not one per escape.
    expect(violations.map((v) => v.nodeType)).toEqual(['escaped_text'])
  })

  it('strips the escaped character when asked to strip', () => {
    const profile = Profile.full().denyInline(['escaped_text']).onDisallowed('strip')
    expect(carveToHtml('A \\*x\\* here.', { profile })).toBe('<p>A x here.</p>')
  })

  it('leaves output unchanged under the default to_text action', () => {
    // Deliberate: the text form of an escaped character IS that character, so
    // to_text degrades to the same bytes. The deny is not a no-op - it is
    // reported, and strip/error act on it - but a caller who only compares
    // output would see no difference, which is why the cases above exist.
    const profile = Profile.full().denyInline(['escaped_text'])
    expect(carveToHtml('A \\*x\\* here.', { profile })).toBe(carveToHtml('A \\*x\\* here.'))
  })

  it('a full profile that denies nothing still leaves escapes alone', () => {
    expect(carveToHtml('A \\*x\\* here.', { profile: Profile.full() })).toBe(
      carveToHtml('A \\*x\\* here.'),
    )
  })
})
