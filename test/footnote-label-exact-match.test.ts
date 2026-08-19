import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

// PART 9 §16: a footnote label may contain spaces and tabs and is matched
// EXACTLY. This engine trimmed the ends of the label on both the definition
// and the reference side, so `[^ a ]` resolved against `[^a]:` where
// carve-php and carve-rs left it literal.
describe('footnote labels are matched exactly', () => {
  it('does not resolve a padded reference against a bare definition', () => {
    const out = carveToHtml('[^ a ]\n\n[^a]: foo\n')
    expect(out).not.toContain('doc-noteref')
    expect(out).toContain('[^ a ]')
  })

  it('does not resolve a bare reference against a padded definition', () => {
    const out = carveToHtml('[^a]\n\n[^ a ]: foo\n')
    expect(out).not.toContain('doc-noteref')
  })

  it('resolves when both sides carry the same padding', () => {
    const out = carveToHtml('[^ a ]\n\n[^ a ]: foo\n')
    expect(out).toContain('doc-noteref')
    expect(out).toContain('foo')
  })

  it('keeps interior whitespace significant', () => {
    expect(carveToHtml('[^a  b]\n\n[^a  b]: foo\n')).toContain('doc-noteref')
    expect(carveToHtml('[^a  b]\n\n[^a b]: foo\n')).not.toContain('doc-noteref')
  })

  it('treats a tab and a space as different labels', () => {
    expect(carveToHtml('[^a\tb]\n\n[^a b]: foo\n')).not.toContain('doc-noteref')
  })

  it('reports a padded definition as unreferenced', () => {
    const findings = lintCarve('[^a]\n\n[^a]: used\n\n[^ a ]: unused\n')
    expect(findings.some((f) => f.rule === 'unused-footnote-definition')).toBe(true)
  })

  it('does not call two differently padded definitions a duplicate', () => {
    const findings = lintCarve('[^a] and [^ a ]\n\n[^a]: one\n\n[^ a ]: two\n')
    expect(findings.some((f) => f.rule === 'duplicate-footnote-definition')).toBe(false)
  })
})
