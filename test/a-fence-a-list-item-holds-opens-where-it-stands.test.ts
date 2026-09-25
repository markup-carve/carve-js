import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * A fence opener inside a list item is read at the position it stands in: at
 * the content column of the INNERMOST item that holds it, and through the
 * marker of a quote that item holds (carve-js#2028).
 *
 * Both readings were taken elsewhere. The column came from the outermost
 * marker, because the item collector consumes only that one into a run's
 * prefix, so past two items of depth every line stood more than three columns
 * from it and read as paragraph text. The quoted opener was never matched at
 * all, so the run reached the inline converter, which escaped an unmatched
 * backtick run and read a tilde run as a strikethrough.
 *
 * Pinned at the RENDERED level: what was wrong is what a reader saw, a code
 * block and its content served as prose. Every expectation below is
 * `commonmark` 0.31.2, quoted at the case, with carve-php as the second
 * reading; neither is carve-js.
 *
 * Indentation is the subject here, so `sp()` builds every run of spaces rather
 * than a pasted literal a formatter could rewrite.
 */
const sp = (n: number): string => ' '.repeat(n)
const lines = (...rows: string[]): string => rows.join('\n') + '\n'
const fence = '```'
const tilde = '~~~'

describe('a fence a list item holds', () => {
  describe('the fixtures carry the columns they claim', () => {
    it('builds indentation as bytes', () => {
      expect(Buffer.from(sp(3)).toString('hex')).toBe('202020')
      expect(Buffer.from(sp(7) + fence).toString('hex')).toBe('20202020202020' + '606060')
      // A tab is one byte and four columns; the two are not interchangeable.
      expect(Buffer.from('\t').toString('hex')).toBe('09')
    })
  })

  describe('measured from the innermost item, not the outermost marker', () => {
    it('opens at three columns of slack two items deep', () => {
      // commonmark: <li><li>a<pre><code></code></pre></li></li>. The inner
      // item's content column is 4, so column 7 is three columns of slack and a
      // fence opens there.
      const carve = markdownToCarve(lines('- - a', sp(7) + fence))
      expect(carve).not.toContain('\\`')
      const html = carveToHtml(carve)
      expect(html).toContain('<pre><code>')
      expect(html).toMatch(/<li>a/)
    })

    it('holds what stood under it, rather than serving it as prose', () => {
      // commonmark: the code block holds `---`, so no rule is rendered.
      const carve = markdownToCarve(lines('- - a', sp(7) + fence, sp(4) + '---'))
      const html = carveToHtml(carve)
      expect(html).toContain('<pre><code>---')
      expect(html).not.toContain('<hr>')
    })

    it('does the same three items deep, at no slack and at three', () => {
      // commonmark: <pre><code>=== </code></pre> inside the innermost item,
      // whose content column is 6.
      for (const at of [6, 9]) {
        const carve = markdownToCarve(lines('- - - a', sp(at) + fence, sp(6) + '==='))
        const html = carveToHtml(carve)
        expect(html).toContain('<pre><code>===')
        expect(html).not.toMatch(/<h1|<h2/)
      }
    })

    it('reads a tilde fence the same way, and writes the canonical spelling', () => {
      const carve = markdownToCarve(lines('- - - a', sp(6) + tilde, sp(6) + '---'))
      expect(carve).toContain(fence)
      expect(carveToHtml(carve)).toContain('<pre><code>---')
    })
  })

  describe('a fence the quote a list item holds opens', () => {
    it('is a code block, and the quote keeps its paragraph', () => {
      // commonmark: <li><blockquote><p>a</p><pre><code></code></pre>
      //   </blockquote></li>. A fence interrupts a paragraph.
      const carve = markdownToCarve(lines('- > a', sp(2) + '> ' + fence))
      const html = carveToHtml(carve)
      expect(html).toMatch(/<blockquote>[\s\S]*<p>a<\/p>/)
      expect(html).toContain('<pre><code>')
      expect(html).not.toContain('```')
    })

    it('closes the fence the source leaves open, so the reading survives', () => {
      // An opener alone is no fence in Carve, so the closer is written; carve-php
      // writes it too.
      const carve = markdownToCarve(lines('- > a', sp(2) + '> ' + fence, sp(2) + '> x'))
      expect(carveToHtml(carve)).toContain('<pre><code>x')
    })

    it('holds the rule that stood under the opener', () => {
      // commonmark: <pre><code>--- </code></pre>, so no <hr>.
      const carve = markdownToCarve(lines('- > a', sp(2) + '> ' + fence, sp(2) + '> ---'))
      const html = carveToHtml(carve)
      expect(html).toContain('<pre><code>---')
      expect(html).not.toContain('<hr>')
    })

    it('takes the tilde spelling, which was read as a strikethrough', () => {
      // `~~~` around `x` reached the inline converter as two strikethrough
      // markers, so the code content became emphasized prose.
      const carve = markdownToCarve(lines('- > a', sp(2) + '> ' + tilde, sp(2) + '> x', sp(2) + '> ' + tilde))
      const html = carveToHtml(carve)
      expect(html).toContain('<pre><code>x')
      expect(html).not.toContain('<del>')
      expect(html).not.toContain('~~')
    })

    it('reads three columns of slack inside the quote as none', () => {
      const carve = markdownToCarve(lines('- > a', sp(2) + '>' + sp(4) + fence, sp(2) + '> x'))
      expect(carveToHtml(carve)).toContain('<pre><code>x')
    })

    it('does the same in an ordered item and two items deep', () => {
      const ordered = markdownToCarve(lines('1. > a', sp(3) + '> ' + fence, sp(3) + '> x'))
      expect(carveToHtml(ordered)).toContain('<pre><code>x')
      const nested = markdownToCarve(lines('- - > a', sp(4) + '> ' + fence, sp(4) + '> x'))
      expect(carveToHtml(nested)).toContain('<pre><code>x')
    })
  })

  describe('controls - readings that were already right', () => {
    it('keeps a fence at a single items content column, at both slacks', () => {
      for (const at of [2, 5]) {
        const html = carveToHtml(markdownToCarve(lines('- a', sp(at) + fence)))
        expect(html).toContain('<pre><code>')
      }
    })

    it('leaves a fence four columns past the item as paragraph text', () => {
      // Four columns in, the line continues the paragraph: indented code cannot
      // interrupt one, so nothing opens and the run keeps its escape.
      const carve = markdownToCarve(lines('- a', sp(6) + fence))
      expect(carve).toContain('\\`')
      const html = carveToHtml(carve)
      expect(html).not.toContain('<pre>')
      expect(html).toMatch(/a\s+```/)
    })

    it('leaves one four columns past the innermost item alone as well', () => {
      const carve = markdownToCarve(lines('- - a', sp(8) + fence))
      expect(carve).toContain('\\`')
      expect(carveToHtml(carve)).not.toContain('<pre>')
    })

    it('keeps a fence on the items own line inside its quote whole', () => {
      // The lines up to the closer are the fence's content, so no block reading
      // is taken on them: an `===` there is code, not a setext underline.
      expect(markdownToCarve(lines('- > ' + fence, sp(2) + '> ===', sp(2) + '> ' + fence))).toBe(
        lines('- > ' + fence, sp(2) + '> ===', sp(2) + '> ' + fence),
      )
      expect(carveToHtml(markdownToCarve(lines('- > ' + fence, sp(2) + '> ===', sp(2) + '> ' + fence)))).toContain(
        '<pre><code>===',
      )
    })

    it('leaves a tilde run on a paragraph continuation line bare', () => {
      // Four columns in, the run opens nothing, and a tilde fence interrupts
      // no paragraph in Carve, so an escape there would spell a construct the
      // source does not hold (carve#2244, carve-js#2020).
      expect(markdownToCarve(lines('a', sp(4) + tilde))).toBe(lines('a', sp(4) + tilde))
    })
  })
})
