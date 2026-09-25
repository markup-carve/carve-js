import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * A link reference definition cannot interrupt a paragraph (CommonMark 4.7), so
 * on a line of the open paragraph of a quote a list item holds it is that
 * paragraph's text and carries the escape (carve-js#2029).
 *
 * Written bare it is a definition to Carve, which renders nothing for one: the
 * line left the document, and the label it registered stayed, so a later
 * reference could resolve to a destination the source never linked.
 *
 * Every assertion names an element AND the text it holds. An absence-only
 * assertion cannot tell a correctly absent element from a swallowed line, which
 * is exactly the failure this file is about - the same trap that let a task-row
 * assertion survive a revert in carve-js#2026.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'

describe('a link reference definition on a quoted continuation line', () => {
  it('stays the quoted paragraphs text', () => {
    // commonmark: <li><blockquote><p>a\n[r]: /u</p></blockquote></li>.
    // carve-php writes the escaped spelling and keeps the line.
    const carve = markdownToCarve(lines('- > a', sp(2) + '> [r]: /u'))
    expect(carve).toContain('\\[r]: /u')
    const html = carveToHtml(carve)
    expect(html).toMatch(/<blockquote><p>a\s*\[r\]: \/u<\/p><\/blockquote>/)
  })

  it('keeps it at three columns of slack inside the quote too', () => {
    const carve = markdownToCarve(lines('- > a', sp(2) + '>' + sp(4) + '[r]: /u'))
    expect(carveToHtml(carve)).toContain('[r]: /u')
  })

  it('does the same in an ordered item and two items deep', () => {
    for (const doc of [
      lines('1. > a', sp(3) + '> [r]: /u'),
      lines('- - > a', sp(4) + '> [r]: /u'),
    ]) {
      const html = carveToHtml(markdownToCarve(doc))
      expect(html).toContain('<blockquote>')
      expect(html).toContain('[r]: /u')
    }
  })

  it('registers no label, so a later reference keeps its text', () => {
    // The swallowed line was a definition document-wide: `[r][]` further down
    // resolved to /u, a link the Markdown source spells nowhere.
    const carve = markdownToCarve(lines('- > a', sp(2) + '> [r]: /u', '', 'see [r][] here'))
    const html = carveToHtml(carve)
    expect(html).not.toContain('href="/u"')
    expect(html).toContain('see')
  })

  describe('controls - the readings that were already right', () => {
    it('leaves a definition the quote really opens alone', () => {
      // After a blank line the quote's paragraph is closed, so the definition
      // opens a block of its own in Markdown as well.
      const carve = markdownToCarve(lines('- > a', sp(2) + '>', sp(2) + '> [r]: /u', '', 'see [r][] here'))
      expect(carve).not.toContain('\\[r]')
      expect(carveToHtml(carve)).toContain('href="/u"')
    })

    it('keeps the escape a document-level quote already wrote', () => {
      const carve = markdownToCarve(lines('> a', '> [r]: /u'))
      expect(carve).toBe(lines('> a', '> \\[r]: /u'))
      expect(carveToHtml(carve)).toContain('[r]: /u')
    })

    it('keeps the escape four columns into the quoted paragraph', () => {
      const carve = markdownToCarve(lines('- > a', sp(2) + '>' + sp(5) + '[r]: /u'))
      expect(carve).toContain('\\[r]: /u')
      expect(carveToHtml(carve)).toContain('[r]: /u')
    })

    it('folds the definition into a heading under a setext underline', () => {
      // The fold writes the unescaped spelling: in the middle of one line the
      // marker opens nothing (carve#2244).
      const carve = markdownToCarve(lines('- > a', sp(2) + '> [r]: /u', sp(2) + '> ---'))
      expect(carve).toBe(lines('- > ## a [r]: /u'))
      expect(carveToHtml(carve)).toMatch(/<h2[^>]*>a \[r\]: \/u<\/h2>/)
    })

    it('leaves a heading in that position bare, since it interrupts', () => {
      // A heading CAN interrupt a paragraph, so it needs no escape there.
      const carve = markdownToCarve(lines('- > a', sp(2) + '> # h'))
      expect(carve).not.toContain('\\#')
      expect(carveToHtml(carve)).toMatch(/<h1[^>]*>h<\/h1>/)
    })
  })
})
