import { describe, expect, it } from 'vitest'
import { applySourcePatch, createSourcePatch, sourceFingerprint } from '../src/source-patch.js'
import { carveToCarvePatch } from '../src/index.js'

describe('source patches', () => {
  it('uses UTF-8 ranges and preserves bytes outside the edit', () => {
    expect(sourceFingerprint('lead ä\n')).toBe('fnv1a64:c6f20701944350f0')
    const source = 'lead ä\nbody   \ntail\n'
    const expected = 'lead ä\nbody\ntail\n'
    const patch = createSourcePatch(source, expected, 'formatting', 'canonical-format')
    expect(patch.edits).toEqual([{ start: 12, end: 15, replacement: '', kind: 'formatting', code: 'canonical-format' }])
    expect(applySourcePatch(source, patch)).toBe(expected)
  })

  it('rejects stale sources and invalid boundaries', () => {
    const patch = createSourcePatch('a', 'b')
    expect(() => applySourcePatch('x', patch)).toThrow(/precondition/)
    patch.sourceFingerprint = createSourcePatch('ä', 'ä').sourceFingerprint
    patch.sourceBytes = 2
    patch.edits = [{ start: 1, end: 2, replacement: '', kind: 'quick-fix', code: 'bad' }]
    expect(() => applySourcePatch('ä', patch)).toThrow(/UTF-8 byte ranges/)
    expect(() => createSourcePatch('\ud800', 'x')).toThrow(/well-formed Unicode/)
  })

  it('does not mistake shared UTF-8 continuation bytes for an unchanged suffix', () => {
    for (const [source, expected] of [['¤', 'ä'], ['see → here', 'see ⇒ here']]) {
      expect(applySourcePatch(source!, createSourcePatch(source!, expected!))).toBe(expected)
    }
  })

  it('prepares canonical formatting as a patch', () => {
    const source = '# Title   '
    expect(applySourcePatch(source, carveToCarvePatch(source))).toBe('# Title\n')
  })
})
