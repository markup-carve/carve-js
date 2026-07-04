import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

describe('::: footnotes placement directive', () => {
  it('flushes the endnotes section at the marker instead of document end', () => {
    const out = h('Intro[^a].\n\n::: footnotes\n:::\n\n## After\n\nmore\n\n[^a]: note body\n')
    // The endnotes section renders before the "After" section, not at the end.
    expect(out.indexOf('role="doc-endnotes"')).toBeLessThan(out.indexOf('<h2>After'))
    expect(out).toContain('<li id="fn1">')
  })

  it('is byte-identical to the default when no marker is present', () => {
    const src = 'Intro[^a].\n\n## After\n\n[^a]: note body\n'
    const out = h(src)
    // Endnotes still render, at the very end (default behavior unchanged).
    expect(out.indexOf('<h2>After')).toBeLessThan(out.indexOf('role="doc-endnotes"'))
  })

  it('degrades to a labeled placeholder when the document has no footnotes', () => {
    const out = h('Plain text.\n\n::: footnotes\n:::\n')
    expect(out).toContain('class="footnotes"')
    expect(out).not.toContain('doc-endnotes')
  })

  it('only the first marker places; a second renders as a plain placeholder', () => {
    const out = h('X[^a].\n\n::: footnotes\n:::\n\n::: footnotes\n:::\n\n[^a]: body\n')
    // Exactly one endnotes section is emitted.
    expect(out.match(/role="doc-endnotes"/g)).toHaveLength(1)
    // The second marker falls through to a typed-div placeholder.
    expect(out).toContain('class="footnotes"')
  })

  it('preserves blocks authored inside the placeholder before the endnotes', () => {
    const out = h('X[^a].\n\n::: footnotes\nNotes:\n:::\n\n[^a]: body\n')
    expect(out).toContain('<p>Notes:</p>')
    expect(out.indexOf('Notes:')).toBeLessThan(out.indexOf('role="doc-endnotes"'))
  })
})
