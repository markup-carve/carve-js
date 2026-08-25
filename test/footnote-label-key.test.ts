import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

describe('footnote label lookup keys', () => {
  it('trim and collapse ASCII whitespace', () => {
    expect(carveToHtml('[^ a\t b ]\n\n[^a b]: foo\n')).toContain('doc-noteref')
  })

  it('keep case and non-ASCII whitespace significant', () => {
    expect(carveToHtml('[^A B]\n\n[^a b]: foo\n')).not.toContain('doc-noteref')
    expect(carveToHtml('[^a\u00a0b]\n\n[^a b]: foo\n')).not.toContain('doc-noteref')
  })

  it('does not make a multiline label syntactically valid', () => {
    expect(carveToHtml('x[^a\nb]\n\n[^a b]: note\n')).not.toContain('doc-noteref')
  })

  it('keeps the first colliding definition body', () => {
    const out = carveToHtml('[^a b]\n\n[^a b]: first\n\n[^ a  b ]: second\n')
    expect(out).toContain('first')
    expect(out).not.toContain('second')
  })

  it('reports the later normalized collision', () => {
    const findings = lintCarve('[^a b]\n\n[^a b]: first\n\n[^ a  b ]: second\n')
    const warning = findings.find((f) => f.rule === 'footnote-labels-differ-only-in-whitespace')
    expect(warning?.message).toContain('normalizes to the same key')
    expect(warning?.message).toContain('"a b"')
  })
})
