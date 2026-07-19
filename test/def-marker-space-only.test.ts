import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

// A definition marker's separator must be a literal SPACE (U+0020), not a tab
// (#288). This matches carve-rs (the reference) and the other markers whose
// grammar delimiter is `space` (heading `# `, list bullets, task `[ ]`). A tab
// after the colon does NOT open a definition -- the line is an ordinary
// paragraph and the tab is preserved literally in its text.
describe('definition marker separator is a literal space, not a tab (#288)', () => {
  describe('a TAB after the marker does not form a definition (paragraph)', () => {
    it('footnote def: `[^a]:\\tTabbed` stays a paragraph', () => {
      expect(html('Use [^a].\n\n[^a]:\tTabbed')).toBe(
        '<p>Use [^a].</p>\n<p>[^a]:\tTabbed</p>',
      )
    })

    it('reference-link def: `[a]:\\t/url` stays a paragraph', () => {
      expect(html('[a]:\t/url\n\n[a][]')).toBe(
        '<p>[a]:\t/url</p>\n<p>[a][]</p>',
      )
    })

    it('abbreviation def: `*[HTML]:\\tHyper` stays a paragraph', () => {
      expect(html('*[HTML]:\tHyper\n\nThe HTML')).toBe(
        '<p>*[HTML]:\tHyper</p>\n<p>The HTML</p>',
      )
    })

    it('a tab-then-space separator also stays a paragraph (first char must be a space)', () => {
      expect(html('*[HTML]:\t Hyper\n\nThe HTML')).toBe(
        '<p>*[HTML]:\t Hyper</p>\n<p>The HTML</p>',
      )
    })
  })

  describe('a SPACE after the marker still forms a definition', () => {
    it('footnote def: `[^a]: Spaced` collects the endnote', () => {
      const out = html('Use [^a].\n\n[^a]: Spaced')
      expect(out).toContain('doc-noteref')
      expect(out).toContain('Spaced')
    })

    it('reference-link def: `[a]: /url` resolves the reference', () => {
      expect(html('[a]: /url\n\n[a][]')).toBe('<p><a href="/url">a</a></p>')
    })

    it('abbreviation def: `*[HTML]: Hyper` renders the abbr', () => {
      expect(html('*[HTML]: Hyper\n\nThe HTML')).toBe(
        '<p>The <abbr title="Hyper">HTML</abbr></p>',
      )
    })
  })

  describe('two-or-more spaces after the marker still forms a definition', () => {
    it('reference-link def: `[a]:  /url` resolves', () => {
      expect(html('[a]:  /url\n\n[a][]')).toBe('<p><a href="/url">a</a></p>')
    })

    it('abbreviation def: `*[HTML]:  Hyper` renders the abbr', () => {
      expect(html('*[HTML]:  Hyper\n\nThe HTML')).toBe(
        '<p>The <abbr title="Hyper">HTML</abbr></p>',
      )
    })

    it('a space-then-tab separator forms a definition with the body trimmed', () => {
      expect(html('*[HTML]: \tHyper\n\nThe HTML')).toBe(
        '<p>The <abbr title="Hyper">HTML</abbr></p>',
      )
    })
  })
})
